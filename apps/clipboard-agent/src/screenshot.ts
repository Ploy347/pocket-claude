import type { ScreenImage } from '@pocket/protocol';
import { powershell } from './clipboard.js';

/** Long side of the picture Claude gets: enough to read UI text, small enough to travel through the relay quickly. */
export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 80;

export interface ScreenBackend {
  capture(): Promise<ScreenImage>;
}

/**
 * All monitors as one JPEG. DPI awareness is needed so a scaled display is captured at full size rather than cropped;
 * the result is then shrunk to MAX_SIDE. Output is one line: width height base64.
 */
export const CAPTURE_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class PocketDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[void][PocketDpi]::SetProcessDPIAware()
$b = [Windows.Forms.SystemInformation]::VirtualScreen
$full = New-Object Drawing.Bitmap $b.Width, $b.Height
$g = [Drawing.Graphics]::FromImage($full)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $full.Size)
$g.Dispose()
$max = [int]$env:POCKET_SHOT_MAX
$scale = [Math]::Min(1.0, $max / [Math]::Max($full.Width, $full.Height))
$w = [Math]::Max(1, [int]($full.Width * $scale))
$h = [Math]::Max(1, [int]($full.Height * $scale))
$img = $full
if ($scale -lt 1.0) {
  $img = New-Object Drawing.Bitmap $w, $h
  $g2 = [Drawing.Graphics]::FromImage($img)
  $g2.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($full, 0, 0, $w, $h)
  $g2.Dispose()
}
$codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), ([long][int]$env:POCKET_SHOT_QUALITY)
$ms = New-Object IO.MemoryStream
$img.Save($ms, $codec, $params)
[Console]::Out.Write([string]$w + ' ' + [string]$h + ' ' + [Convert]::ToBase64String($ms.ToArray()))
`;

/** Parses the capture script's single output line. */
export function parseCapture(out: string): ScreenImage {
  const m = /^\s*(\d+) (\d+) ([A-Za-z0-9+/=]+)\s*$/.exec(out.replace(/^\uFEFF/, ''));
  if (!m) throw new Error('Screenshot failed: unexpected output');
  return { mime: 'image/jpeg', dataBase64: m[3]!, width: Number(m[1]), height: Number(m[2]) };
}

export const windowsScreen: ScreenBackend = {
  capture: async () => parseCapture(await powershell(CAPTURE_PS, { env: { POCKET_SHOT_MAX: String(MAX_SIDE), POCKET_SHOT_QUALITY: String(JPEG_QUALITY) } })),
};
