// DOM-free types shared by the browser painter and the Node render driver.
import type { TextNode } from "../contracts/types.js";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A text node as painted: its role, text, and measured box (before scrim padding). */
export interface MeasuredText {
  role: TextNode["role"];
  text: string;
  color: string;
  box: Box;
}

export interface DrawOptions {
  /** Text roles left out of the frame, used to sample the backing behind captions. */
  omitRoles?: TextNode["role"][];
}
