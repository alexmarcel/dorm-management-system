// Shared metadata contains no secrets and is safe to use in the settings UI.
export type LimitDefinition = {
  key: string;
  group: string;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  scale: number;
};
const define = (
  key: string,
  group: string,
  label: string,
  defaultValue: number,
  max: number,
  scale = 1,
  min = 1,
): LimitDefinition => ({ key, group, label, defaultValue, min, max, scale });
export const LIMIT_DEFINITIONS: LimitDefinition[] = [
  define(
    "LOGIN_GLOBAL_LIMIT",
    "Login protection",
    "All login attempts per window",
    120,
    10000,
  ),
  define(
    "LOGIN_UNKNOWN_SOURCE_LIMIT",
    "Login protection",
    "Unknown-source attempts per window",
    60,
    10000,
  ),
  define(
    "LOGIN_SOURCE_LIMIT",
    "Login protection",
    "Attempts per source per window",
    30,
    10000,
  ),
  define(
    "LOGIN_ACCOUNT_SOURCE_LIMIT",
    "Login protection",
    "Attempts per account and source",
    10,
    1000,
  ),
  define(
    "LOGIN_CONCURRENCY",
    "Login protection",
    "Concurrent password checks",
    4,
    32,
  ),
  define(
    "LOGIN_WINDOW_SECONDS",
    "Time windows",
    "Login window (seconds)",
    60,
    3600,
  ),
  define(
    "LOGIN_ACCOUNT_WINDOW_SECONDS",
    "Time windows",
    "Account and source window (seconds)",
    900,
    86400,
  ),
  define(
    "QUOTA_SHORT_WINDOW_SECONDS",
    "Time windows",
    "Write and upload window (seconds)",
    60,
    3600,
  ),
  define(
    "QUOTA_DAILY_WINDOW_HOURS",
    "Time windows",
    "Daily quota window (hours)",
    24,
    168,
  ),
  ...(["STUDENT", "WARDEN"] as const).flatMap((role) => {
    const student = role === "STUDENT",
      group = student ? "Student quotas" : "Warden quotas";
    return [
      define(
        `QUOTA_${role}_MUTATIONS`,
        group,
        "Write requests per short window",
        student ? 60 : 300,
        10000,
      ),
      define(
        `QUOTA_${role}_UPLOADS`,
        group,
        "Photo uploads per short window",
        student ? 20 : 60,
        1000,
      ),
      define(
        `QUOTA_${role}_BYTES`,
        group,
        "Uploaded photo data per daily window (MB)",
        student ? 10000000 : 50000000,
        10000000000,
        1000000,
      ),
      ...(student
        ? [
            define(
              "QUOTA_STUDENT_REPORTS",
              group,
              "Reports per daily window",
              10,
              1000,
            ),
          ]
        : []),
      define(
        `QUOTA_${role}_EVENTS`,
        group,
        "Replies and status updates per daily window",
        student ? 50 : 300,
        10000,
      ),
      define(
        `QUOTA_${role}_RETAINED`,
        group,
        "Retained photo storage (MB)",
        student ? 100000000 : 500000000,
        100000000000,
        1000000,
      ),
    ];
  }),
  define(
    "QUOTA_SUPERADMIN_MUTATIONS",
    "Superadmin quotas",
    "Write requests per short window",
    300,
    10000,
  ),
  define(
    "PHOTO_MAX_BYTES",
    "Photo limits",
    "Maximum photo size (KB)",
    500000,
    500000,
    1000,
    1000,
  ),
  define(
    "PHOTO_MAX_DIMENSION",
    "Photo limits",
    "Maximum width and height (pixels)",
    1600,
    1600,
  ),
  define(
    "PHOTO_MAX_ATTACHMENTS",
    "Photo limits",
    "Photos per report or event",
    5,
    5,
  ),
  define(
    "PHOTO_MAX_PENDING",
    "Photo limits",
    "Pending photos per user",
    50,
    1000,
  ),
  define(
    "PHOTO_EXPIRY_HOURS",
    "Photo limits",
    "Unattached photo expiry (hours)",
    24,
    168,
  ),
];
export type PhotoPolicy = {
  maxBytes: number;
  maxDimension: number;
  maxAttachments: number;
};
export const DEFAULT_PHOTO_POLICY: PhotoPolicy = {
  maxBytes: 500000,
  maxDimension: 1600,
  maxAttachments: 5,
};
export type LimitSnapshot = {
  values: Record<string, number>;
  defaults: Record<string, number>;
  revision: string;
};
