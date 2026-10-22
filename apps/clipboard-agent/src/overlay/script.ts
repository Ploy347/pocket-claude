/**
 * The overlay window: Windows PowerShell 5.1 + WinForms, driven by the agent over stdin/stdout (one JSON object per line).
 * Read-only: it shows the chat and copies text to the clipboard, nothing else. Double-tap Alt shows it, a single Alt tap
 * (or Esc) hides it. Compact window in the bottom-right corner, dark or light.
 *
 * Kept as a string so the single-file PocketClipboard.exe can write it next to its state and run it. Because this is a
 * JS template literal the PowerShell must avoid backticks (newlines are $NL) and the dollar-brace interpolation sequence.
 */
export const OVERLAY_PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false

Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public class PocketOverlayForm : Form {
    // Showing never steals focus from the editor; WS_EX_TOOLWINDOW keeps it out of Alt+Tab, WS_EX_TOPMOST above everything.
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get { CreateParams cp = base.CreateParams; cp.ExStyle |= 0x80 | 0x8; return cp; }
    }
}

public static class PocketNative {
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}

// Console.In cannot be read without blocking the UI thread, so a background thread queues lines.
public static class PocketStdin {
    static readonly ConcurrentQueue<string> queue = new ConcurrentQueue<string>();
    static volatile bool closed;
    public static bool Closed { get { return closed && queue.IsEmpty; } }
    public static void Start() {
        Thread t = new Thread(delegate() {
            try {
                using (StreamReader r = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false))) {
                    string line;
                    while ((line = r.ReadLine()) != null) queue.Enqueue(line);
                }
            } catch (Exception) { }
            closed = true;
        });
        t.IsBackground = true;
        t.Start();
    }
    public static string Next() { string s; return queue.TryDequeue(out s) ? s : null; }
}
'@

[void][PocketNative]::SetProcessDPIAware()
$NL = [string][char]10

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

function Rgb($r, $g, $b) { [Drawing.Color]::FromArgb($r, $g, $b) }
$THEMES = @{
  dark = @{
    bg = Rgb 0 0 0; panel = Rgb 16 16 18; text = Rgb 236 236 240; muted = Rgb 138 138 148; accent = Rgb 122 162 247
    code = Rgb 22 22 27; codeText = Rgb 222 226 234; inline = Rgb 201 164 255; error = Rgb 237 73 86; quote = Rgb 176 176 186
  }
  light = @{
    bg = Rgb 255 255 255; panel = Rgb 242 242 245; text = Rgb 24 24 28; muted = Rgb 112 112 122; accent = Rgb 38 86 196
    code = Rgb 240 240 244; codeText = Rgb 30 30 36; inline = Rgb 118 58 184; error = Rgb 198 38 54; quote = Rgb 92 92 102
  }
}
$script:themeName = 'dark'
$script:C = $THEMES.dark

function Font($name, $size, $style) { New-Object Drawing.Font $name, $size, ([Drawing.FontStyle]$style) }
$F = @{
  text = Font 'Segoe UI' 10 'Regular'; bold = Font 'Segoe UI' 10 'Bold'; italic = Font 'Segoe UI' 10 'Italic'; boldItalic = Font 'Segoe UI' 10 'Bold, Italic'
  link = Font 'Segoe UI' 10 'Underline'; mono = Font 'Consolas' 9.5 'Regular'; label = Font 'Segoe UI' 8.5 'Bold'; small = Font 'Segoe UI' 8.5 'Regular'
  title = Font 'Segoe UI' 9.5 'Bold'; icon = Font 'Segoe UI Symbol' 11 'Regular'
  h1 = Font 'Segoe UI' 13 'Bold'; h2 = Font 'Segoe UI' 12 'Bold'; h3 = Font 'Segoe UI' 11 'Bold'
}

$form = New-Object PocketOverlayForm
$form.Text = 'Pocket'
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.StartPosition = 'Manual'
$form.KeyPreview = $true
$scale = $form.CreateGraphics().DpiX / 96
$wa = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$width = [int](400 * $scale)
$margin = [int](12 * $scale)
$script:compactHeight = [Math]::Min([int](500 * $scale), $wa.Height - 2 * $margin)
$script:tall = $false
function Place-Window {
  $h = if ($script:tall) { $wa.Height - 2 * $margin } else { $script:compactHeight }
  $form.Size = New-Object Drawing.Size $width, $h
  $form.Location = New-Object Drawing.Point ($wa.Right - $width - $margin), ($wa.Bottom - $h - $margin)
}
Place-Window

$rtb = New-Object Windows.Forms.RichTextBox
$rtb.Dock = 'Fill'
$rtb.ReadOnly = $true
$rtb.BorderStyle = 'None'
$rtb.Font = $F.text
$rtb.ScrollBars = 'Vertical'
$rtb.WordWrap = $true
$rtb.DetectUrls = $false
$rtb.HideSelection = $false
$rtb.Margin = New-Object Windows.Forms.Padding 0
$form.Controls.Add($rtb)

function Make-Icon($text) {
  $l = New-Object Windows.Forms.Label
  $l.Dock = 'Right'
  $l.Width = [int](30 * $scale)
  $l.TextAlign = 'MiddleCenter'
  $l.Font = $F.icon
  $l.Text = $text
  $l.Cursor = [Windows.Forms.Cursors]::Hand
  $l
}
$header = New-Object Windows.Forms.Panel
$header.Dock = 'Top'
$header.Height = [int](32 * $scale)
$title = New-Object Windows.Forms.Label
$title.Dock = 'Fill'
$title.TextAlign = 'MiddleLeft'
$title.Padding = New-Object Windows.Forms.Padding ([int](12 * $scale)), 0, 0, 0
$title.Font = $F.title
$title.Text = 'Pocket'
$title.AutoEllipsis = $true
$hide = Make-Icon ([string][char]0x2715)
$themeBtn = Make-Icon ([string][char]0x25D0)
$tallBtn = Make-Icon ([string][char]0x2195)
# Right-docked controls lay out last-added first: the cross ends up in the corner.
$header.Controls.Add($title)
$header.Controls.Add($tallBtn)
$header.Controls.Add($themeBtn)
$header.Controls.Add($hide)
$form.Controls.Add($header)

$bar = New-Object Windows.Forms.Panel
$bar.Dock = 'Bottom'
$bar.Height = [int](36 * $scale)
function Make-Button($text) {
  $b = New-Object Windows.Forms.Button
  $b.Text = $text
  $b.FlatStyle = 'Flat'
  $b.FlatAppearance.BorderSize = 0
  $b.Font = $F.small
  $b.Dock = 'Right'
  $b.Width = [int](86 * $scale)
  $b.TabStop = $false
  $b.Cursor = [Windows.Forms.Cursors]::Hand
  $b
}
$copyReply = Make-Button 'Copy reply'
$copyCode = Make-Button 'Copy code'
$status = New-Object Windows.Forms.Label
$status.Dock = 'Fill'
$status.TextAlign = 'MiddleLeft'
$status.Padding = New-Object Windows.Forms.Padding ([int](12 * $scale)), 0, 0, 0
$status.Font = $F.small
$status.AutoEllipsis = $true
$bar.Controls.Add($status)
$bar.Controls.Add($copyReply)
$bar.Controls.Add($copyCode)
$form.Controls.Add($bar)

$script:note = ''
$script:messages = New-Object System.Collections.ArrayList
$script:starts = @{}
$script:codeBlocks = New-Object System.Collections.ArrayList

function Apply-Theme {
  $C = $script:C
  $form.BackColor = $C.bg
  $rtb.BackColor = $C.bg
  $rtb.ForeColor = $C.text
  $header.BackColor = $C.panel
  $bar.BackColor = $C.panel
  $title.ForeColor = $C.text
  $status.ForeColor = $C.muted
  foreach ($l in @($hide, $themeBtn, $tallBtn)) { $l.ForeColor = $C.muted; $l.BackColor = $C.panel }
  foreach ($b in @($copyReply, $copyCode)) { $b.ForeColor = $C.text; $b.BackColor = $C.panel; $b.FlatAppearance.MouseOverBackColor = $C.code }
}

function Append([string]$text, $font, $color, $back) {
  $rtb.SelectionStart = $rtb.TextLength
  $rtb.SelectionLength = 0
  $rtb.SelectionFont = $font
  $rtb.SelectionColor = $color
  $rtb.SelectionBackColor = $back
  $rtb.AppendText($text)
}

function Run-Font($run, $base) {
  if ($run.code) { return $F.mono }
  if ($run.link) { return $F.link }
  if ($run.bold -and $run.italic) { return $F.boldItalic }
  if ($run.bold) { return $F.bold }
  if ($run.italic) { return $F.italic }
  return $base
}

function Append-Inline($runs, $base, $color) {
  $C = $script:C
  foreach ($run in @($runs)) {
    if ($null -eq $run) { continue }
    $c = $color
    if ($run.code) { $c = $C.inline } elseif ($run.link) { $c = $C.accent }
    Append ([string]$run.text) (Run-Font $run $base) $c $C.bg
  }
}

function Append-Blocks($m, $color) {
  $C = $script:C
  foreach ($b in @($m.blocks)) {
    if ($null -eq $b) { continue }
    switch ($b.type) {
      'code' {
        if ($b.lang) { Append ($b.lang + $NL) $F.small $C.muted $C.bg }
        $s = $rtb.TextLength
        Append ($b.text + $NL) $F.mono $C.codeText $C.code
        [void]$script:codeBlocks.Add(@{ start = $s; length = $b.text.Length; text = $b.text })
        Append $NL $F.text $color $C.bg
      }
      'heading' {
        $hf = $F.h3
        if ($b.level -eq 1) { $hf = $F.h1 } elseif ($b.level -eq 2) { $hf = $F.h2 }
        Append-Inline $b.inline $hf $color
        Append ($NL + $NL) $F.text $color $C.bg
      }
      'list' {
        $n = 1
        foreach ($item in @($b.items)) {
          $prefix = if ($b.ordered) { [string]$n + '. ' } else { [string][char]0x2022 + ' ' }
          Append $prefix $F.text $C.muted $C.bg
          Append-Inline $item $F.text $color
          Append $NL $F.text $color $C.bg
          $n++
        }
        Append $NL $F.text $color $C.bg
      }
      'quote' {
        Append ([string][char]0x2502 + ' ') $F.text $C.muted $C.bg
        Append-Inline $b.inline $F.italic $C.quote
        Append ($NL + $NL) $F.text $color $C.bg
      }
      'rule' { Append (([string][char]0x2500) * 24 + $NL + $NL) $F.small $C.muted $C.bg }
      default {
        Append-Inline $b.inline $F.text $color
        Append ($NL + $NL) $F.text $color $C.bg
      }
    }
  }
}

function Render-Message($m) {
  $C = $script:C
  $script:starts[$m.id] = $rtb.TextLength
  switch ($m.role) {
    'user' {
      Append ('You' + $NL) $F.label $C.muted $C.bg
      Append-Blocks $m $C.muted
      if ($m.note) { Append ('+ ' + $m.note + $NL + $NL) $F.small $C.muted $C.bg }
    }
    'assistant' {
      Append ('Claude' + $NL) $F.label $C.accent $C.bg
      Append-Blocks $m $C.text
      if ($m.streaming) { Append ([string][char]0x258D + $NL + $NL) $F.text $C.accent $C.bg }
    }
    'tool' {
      $line = [string][char]0x2699 + ' ' + $m.text
      if ($m.streaming) { $line += ' ...' }
      if ($m.note) { $line += ' (' + $m.note + ')' }
      Append ($line + $NL + $NL) $F.small $C.muted $C.bg
    }
    'error' { Append ($m.text + $NL + $NL) $F.text $C.error $C.bg }
  }
}

function At-Bottom {
  if ($rtb.TextLength -eq 0) { return $true }
  $p = $rtb.GetPositionFromCharIndex($rtb.TextLength - 1)
  return $p.Y -lt $rtb.ClientSize.Height
}

function Redraw-All {
  $rtb.Clear()
  $script:starts = @{}
  $script:codeBlocks.Clear()
  foreach ($m in $script:messages) { Render-Message $m }
}

# Edits happen with ReadOnly off: a read-only RichTextBox ignores deletions, which is how a streaming reply used to pile up copies.
function Update-Window([scriptblock]$change) {
  $bottom = At-Bottom
  [void][PocketNative]::SendMessage($rtb.Handle, 0x0B, [IntPtr]::Zero, [IntPtr]::Zero)
  $rtb.ReadOnly = $false
  try { & $change } finally {
    $rtb.ReadOnly = $true
    [void][PocketNative]::SendMessage($rtb.Handle, 0x0B, [IntPtr]1, [IntPtr]::Zero)
    $rtb.Invalidate()
  }
  if ($bottom) {
    $rtb.SelectionStart = $rtb.TextLength
    $rtb.SelectionLength = 0
    $rtb.ScrollToCaret()
  }
}

function Index-Of($id) {
  for ($i = 0; $i -lt $script:messages.Count; $i++) { if ($script:messages[$i].id -eq $id) { return $i } }
  return -1
}

function Set-Theme($name) {
  if (-not $THEMES.ContainsKey($name)) { return }
  $script:themeName = $name
  $script:C = $THEMES[$name]
  Apply-Theme
  Update-Window { Redraw-All }
}

function Handle-Op($op) {
  switch ($op.op) {
    'reset' {
      $title.Text = $op.title
      if ($op.theme -and $op.theme -ne $script:themeName -and $THEMES.ContainsKey([string]$op.theme)) {
        $script:themeName = [string]$op.theme
        $script:C = $THEMES[$script:themeName]
        Apply-Theme
      }
      Update-Window {
        $script:messages = New-Object System.Collections.ArrayList
        foreach ($m in @($op.messages)) { if ($null -ne $m) { [void]$script:messages.Add($m) } }
        Redraw-All
      }
    }
    'upsert' {
      $m = $op.message
      $i = Index-Of $m.id
      Update-Window {
        if ($i -lt 0) {
          [void]$script:messages.Add($m)
          Render-Message $m
        } elseif ($i -eq $script:messages.Count - 1) {
          # Streaming: rewrite only the tail, in place.
          $script:messages[$i] = $m
          $start = $script:starts[$m.id]
          $rtb.Select($start, $rtb.TextLength - $start)
          $rtb.SelectedText = ''
          if ($rtb.TextLength -ne $start) { Redraw-All } else {
            for ($k = $script:codeBlocks.Count - 1; $k -ge 0; $k--) { if ($script:codeBlocks[$k].start -ge $start) { $script:codeBlocks.RemoveAt($k) } }
            Render-Message $m
          }
        } else {
          $script:messages[$i] = $m
          Redraw-All
        }
      }
    }
    'title' { $title.Text = $op.title }
    'status' { $script:note = [string]$op.text; $status.Text = $script:note }
    'theme' { if ($op.theme -ne $script:themeName) { Set-Theme ([string]$op.theme) } }
    'quit' { [Windows.Forms.Application]::Exit() }
  }
}

$flash = New-Object Windows.Forms.Timer
$flash.Interval = 1200
$flash.add_Tick({ $flash.Stop(); $status.Text = $script:note })
function Flash($text) { $status.Text = $text; $flash.Stop(); $flash.Start() }

function Copy-Text($text, $what) {
  if (-not $text) { Flash 'Nothing to copy'; return }
  [Windows.Forms.Clipboard]::SetText($text)
  Flash 'Copied'
  Emit @{ ev = 'copied'; what = $what }
}

function Code-At($pos) {
  foreach ($b in $script:codeBlocks) { if ($pos -ge $b.start -and $pos -le $b.start + $b.length) { return $b } }
  return $null
}

# The message under the caret, so "Copy reply" takes the one the user clicked into; otherwise the last reply.
function Message-At($pos) {
  $hit = $null
  foreach ($m in $script:messages) {
    if ($m.role -ne 'assistant') { continue }
    $s = $script:starts[$m.id]
    if ($null -ne $s -and $pos -ge $s) { $hit = $m }
  }
  return $hit
}

function Show-Overlay { if (-not $form.Visible) { $form.Show(); Emit @{ ev = 'visible'; visible = $true } } }
function Hide-Overlay { if ($form.Visible) { $form.Hide(); Emit @{ ev = 'visible'; visible = $false } } }

$copyCode.add_Click({
  $b = Code-At $rtb.SelectionStart
  if (-not $b -and $script:codeBlocks.Count -gt 0) { $b = $script:codeBlocks[$script:codeBlocks.Count - 1] }
  if ($b) { Copy-Text $b.text 'code' } else { Flash 'No code in this chat' }
})
$copyReply.add_Click({
  $m = Message-At $rtb.SelectionStart
  if (-not $m) { foreach ($x in $script:messages) { if ($x.role -eq 'assistant') { $m = $x } } }
  if ($m) { Copy-Text $m.text 'reply' } else { Flash 'No reply yet' }
})
$rtb.add_MouseDoubleClick({
  $b = Code-At $rtb.SelectionStart
  if ($b) {
    $rtb.Select($b.start, $b.length)
    Copy-Text $b.text 'code'
  }
})
$hide.add_Click({ Hide-Overlay })
$themeBtn.add_Click({
  $next = if ($script:themeName -eq 'dark') { 'light' } else { 'dark' }
  Set-Theme $next
  Emit @{ ev = 'theme'; theme = $next }
})
$tallBtn.add_Click({ $script:tall = -not $script:tall; Place-Window })
$drag = {
  [void][PocketNative]::ReleaseCapture()
  [void][PocketNative]::SendMessage($form.Handle, 0xA1, [IntPtr]2, [IntPtr]::Zero)
}
$header.add_MouseDown($drag)
$title.add_MouseDown($drag)
$form.add_KeyDown({
  if ($_.KeyCode -eq [Windows.Forms.Keys]::Escape) { Hide-Overlay; $_.Handled = $true }
})

# Alt handling: a short Alt tap with no other key hides the window; two such taps within 450 ms show it.
$script:altDown = $false
$script:altSince = 0
$script:altCombo = $false
$script:lastTap = 0
$comboKeys = @(0x09, 0x0D, 0x1B, 0x20, 0x10, 0x11, 0x5B, 0x73) + (0x30..0x5A)
$keys = New-Object Windows.Forms.Timer
$keys.Interval = 25
$keys.add_Tick({
  $now = [Environment]::TickCount
  $down = ([PocketNative]::GetAsyncKeyState(0x12) -band 0x8000) -ne 0
  if ($down) {
    if (-not $script:altDown) { $script:altDown = $true; $script:altSince = $now; $script:altCombo = $false }
    if (-not $script:altCombo) {
      foreach ($vk in $comboKeys) { if (([PocketNative]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) { $script:altCombo = $true; break } }
    }
  } elseif ($script:altDown) {
    $script:altDown = $false
    $tap = (-not $script:altCombo) -and (($now - $script:altSince) -lt 350)
    if (-not $tap) { $script:lastTap = 0 }
    elseif ($form.Visible) { $script:lastTap = 0; Hide-Overlay }
    elseif (($now - $script:lastTap) -lt 450) { $script:lastTap = 0; Show-Overlay }
    else { $script:lastTap = $now }
  }
})

$io = New-Object Windows.Forms.Timer
$io.Interval = 30
$io.add_Tick({
  for ($n = 0; $n -lt 50; $n++) {
    $line = [PocketStdin]::Next()
    if ($null -eq $line) {
      if ([PocketStdin]::Closed) { [Windows.Forms.Application]::Exit() }
      break
    }
    try { Handle-Op ($line | ConvertFrom-Json) } catch { Emit @{ ev = 'error'; message = $_.Exception.Message } }
  }
})

Apply-Theme
[PocketStdin]::Start()
$keys.Start()
$io.Start()
Emit @{ ev = 'ready' }
[Windows.Forms.Application]::Run()
`;
