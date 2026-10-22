import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

type Icon = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** A chat with Claude is dressed up as a brand's support chat; each chat gets one, picked by its id, so the inbox looks like many companies. */
export interface Persona {
  name: string;
  username: string;
  icon: Icon;
  /** Avatar gradient and the icon colour on it. */
  gradient: readonly [string, string];
  ink: string;
}

export const PERSONAS: readonly Persona[] = [
  { name: 'Lipton', username: 'lipton', icon: 'tea', gradient: ['#FFE14D', '#FFC20E'], ink: '#D7141A' },
  { name: 'Nescafé', username: 'nescafe', icon: 'coffee', gradient: ['#B5533C', '#7A2E1D'], ink: '#FFF3E0' },
  { name: 'Starbucks', username: 'starbucks', icon: 'coffee-outline', gradient: ['#1E8C5A', '#00704A'], ink: '#FFFFFF' },
  { name: 'Jacobs', username: 'jacobs', icon: 'coffee-maker', gradient: ['#2F7A3E', '#1C5A2B'], ink: '#F6E7B5' },
  { name: 'Red Bull', username: 'redbull', icon: 'bottle-soda', gradient: ['#2353A0', '#14306B'], ink: '#FFD200' },
  { name: 'Coca-Cola', username: 'cocacola', icon: 'bottle-soda-classic', gradient: ['#F40009', '#B80009'], ink: '#FFFFFF' },
  { name: 'Borjomi', username: 'borjomi', icon: 'water', gradient: ['#1FA2C8', '#0C6E92'], ink: '#FFFFFF' },
  { name: 'Alpen Gold', username: 'alpengold', icon: 'candy', gradient: ['#8E44AD', '#5B2C6F'], ink: '#F8E36B' },
  { name: 'Pringles', username: 'pringles', icon: 'food', gradient: ['#E53935', '#9B1B1B'], ink: '#FFFFFF' },
  { name: 'IKEA', username: 'ikea', icon: 'sofa', gradient: ['#0058A3', '#003D73'], ink: '#FFDA1A' },
  { name: 'Samsung', username: 'samsung', icon: 'cellphone', gradient: ['#1428A0', '#0B1766'], ink: '#FFFFFF' },
  { name: 'Lego', username: 'lego', icon: 'toy-brick', gradient: ['#FFD500', '#E3A700'], ink: '#D01012' },
  { name: 'Adidas', username: 'adidas', icon: 'shoe-sneaker', gradient: ['#2B2B2B', '#000000'], ink: '#FFFFFF' },
  { name: 'Spotify', username: 'spotify', icon: 'music', gradient: ['#1DB954', '#13803A'], ink: '#101010' },
  { name: 'Tesla', username: 'tesla', icon: 'car-electric', gradient: ['#E82127', '#9B1218'], ink: '#FFFFFF' },
  { name: 'Aeroflot', username: 'aeroflot', icon: 'airplane', gradient: ['#1E4FA3', '#0F2F66'], ink: '#F5A623' },
] as const;

/** The persona Claude wears in one chat: stable for the chat's lifetime, spread evenly across chats. */
export function personaFor(sessionId: string | undefined): Persona {
  if (!sessionId) return PERSONAS[0]!;
  let h = 2166136261;
  for (let i = 0; i < sessionId.length; i++) h = Math.imul(h ^ sessionId.charCodeAt(i), 16777619);
  return PERSONAS[(h >>> 0) % PERSONAS.length]!;
}

/** Kept for places that have no chat yet. */
export const PERSONA = PERSONAS[0]!;
