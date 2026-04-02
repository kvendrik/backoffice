export interface DangerousCommand {
  /** Binary names that match (checked via `Bun.which` resolved path ending). */
  binaries: string[];
  /** When set, only deny when these flag patterns appear in args (exact or prefix match). */
  flags?: string[];
  reason: string;
}

/**
 * Commands that are always blocked regardless of arguments.
 */
const ALWAYS_BLOCKED: DangerousCommand[] = [
  // Shell interpreters – bypass the no-shell execve design
  {
    binaries: ["bash", "sh", "zsh", "dash", "ksh", "csh", "tcsh", "fish", "env"],
    reason: "shell interpreters are not allowed (bypasses execve policy)",
  },
  // Privilege escalation
  {
    binaries: ["sudo", "doas", "su"],
    reason: "privilege escalation is not allowed",
  },
  // Destructive disk operations
  {
    binaries: ["dd", "shred", "mkfs", "fdisk", "diskutil", "parted"],
    reason: "destructive disk operations are not allowed",
  },
  // System control
  {
    binaries: ["shutdown", "reboot", "halt", "poweroff"],
    reason: "system power commands are not allowed",
  },
  // Reverse shells / raw network
  {
    binaries: ["nc", "ncat", "netcat"],
    reason: "raw network tools are not allowed",
  },
  // Permission changes
  {
    binaries: ["chmod", "chown", "chgrp"],
    reason: "permission changes are not allowed",
  },
  // Process control
  {
    binaries: ["kill", "killall", "pkill"],
    reason: "process control commands are not allowed",
  },
];

/**
 * Commands that are only blocked when specific flags are present.
 */
const FLAG_BLOCKED: DangerousCommand[] = [
  {
    binaries: ["curl", "wget"],
    flags: ["--upload-file", "-T", "--data", "-d", "-X", "--request", "-F", "--form"],
    reason: "upload/POST requests are not allowed",
  },
  {
    binaries: ["git"],
    flags: ["--force", "-f", "--hard"],
    reason: "destructive git operations are not allowed",
  },
];

export const DANGEROUS_COMMANDS: DangerousCommand[] = [...ALWAYS_BLOCKED, ...FLAG_BLOCKED];
