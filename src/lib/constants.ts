export const BRAND = {
  short: "PAINI",
  expanded: "Pengurusan Asrama, Inventori, Naziran dan Insiden",
  full: "PAINI - Pengurusan Asrama, Inventori, Naziran dan Insiden",
};
export const STATUSES = [
  "Submitted",
  "Acknowledged",
  "In progress",
  "Closed",
] as const;
export const CATEGORIES = [
  "Locks/doors",
  "Lighting",
  "Electricity",
  "Plumbing",
  "Furniture",
  "Other",
] as const;
export type Status = (typeof STATUSES)[number];
export interface User {
  id: string;
  name: string;
  username: string;
  role: "student" | "warden" | "superadmin";
  student_id: string | null;
  room_id: string | null;
  active: number;
  must_change: number;
  phone?: string | null;
  email?: string | null;
  archived_at?: string | null;
  created_at?: string;
}
export interface Block {
  id: string;
  name: string;
  code: string;
  archived: number;
}
export interface Level extends Block {
  block_id: string;
  sort_order: number;
}
export interface Room {
  id: string;
  name: string;
  level_id: string;
  archived: number;
  available: number;
  label: string;
  block_id: string;
}
export interface Locations {
  blocks: Block[];
  levels: Level[];
  rooms: Room[];
}
export interface Report {
  id: string;
  report_number: string;
  creator_id: string;
  room_id: string;
  title: string;
  description: string;
  category: string;
  status: Status;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  closed_by: string | null;
  snapshot: string | null;
  location: string;
  creator_name: string;
  block_id: string;
  level_id: string;
  block_name: string;
  latest_message?: string;
}
export interface Attachment {
  id: string;
  width: number;
  height: number;
  bytes: number;
}
export interface TimelineEvent {
  id: string;
  report_id: string;
  actor_id: string;
  actor_name: string;
  actor_role: string;
  kind: string;
  message: string;
  created_at: string;
  new_status: string | null;
  attachments: Attachment[];
  report_number?: string;
  location?: string;
}
export function dateTime(value: string, locale: "ms" | "en" = "ms") {
  return new Intl.DateTimeFormat(locale === "ms" ? "ms-MY" : "en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
