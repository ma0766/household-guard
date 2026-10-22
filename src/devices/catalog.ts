import type { Kind } from '../policy/kinds.js';

// The devices a house can add. A device says which kinds of action it offers when it is connected: that is its declaration,
// and the house never takes a kind the device did not declare. These are STAND-INS (no real vendor sign-in yet):
// the "robot vacuum" stands in for the Home Assistant demo vacuum, so the whole flow runs offline.
export interface DeviceInfo {
  service: string; // the id the house uses
  name: string; // what people hear
  words: RegExp; // how a person names it
  kinds: Kind[]; // what it offers
  standIn: boolean;
}

export const DEVICES: DeviceInfo[] = [
  { service: 'robot-vacuum', name: 'the robot vacuum', words: /\b(robot )?vacuum|roomba\b/i, kinds: ['control', 'money'], standIn: true },
];

export const deviceByWords = (text: string): DeviceInfo | undefined => DEVICES.find((d) => d.words.test(text));
export const deviceByService = (service: string): DeviceInfo | undefined => DEVICES.find((d) => d.service === service);
