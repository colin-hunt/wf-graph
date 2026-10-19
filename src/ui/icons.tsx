import {
  Bot,
  CircleAlert,
  CircleArrowOutDownRight,
  CloudUpload,
  FileText,
  FingerprintPattern,
  FlaskConical,
  GitBranchMinus,
  Globe,
  Hammer,
  MessageSquare,
  MessageSquareText,
  PackageOpen,
  PackageSearch,
  Plane,
  Send,
  Smartphone,
  SquareTerminal,
  UserCheck,
  Waypoints,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

/**
 * An icon for every EAS job `type`. A test checks this list against the
 * live EAS schema, on every CI build and once a week.
 */
export const EAS_JOB_ICONS: Record<string, LucideIcon> = {
  agent: Bot,
  build: Hammer,
  custom: SquareTerminal,
  deploy: Globe,
  fingerprint: FingerprintPattern,
  'get-build': PackageSearch,
  'maestro-cloud': FlaskConical,
  maestro: FlaskConical,
  'require-approval': UserCheck,
  'apple-device-registration-request': Smartphone,
  submit: Send,
  testflight: Plane,
  update: CloudUpload,
  slack: MessageSquare,
  doc: FileText,
  repack: PackageOpen,
  'github-comment': MessageSquareText,
  'branch-delete': GitBranchMinus,
  'update-rollout': Waypoints,
};

export const TriggerIcon = CircleArrowOutDownRight;
export const ErrorIcon = CircleAlert;

export function iconFor(kind: string): LucideIcon {
  if (kind === 'uses') return Workflow;
  return EAS_JOB_ICONS[kind] ?? SquareTerminal;
}

/** Shared props so every icon matches the console's 16px outline icons. */
export const ICON_PROPS = { size: 16, strokeWidth: 1.75, absoluteStrokeWidth: true } as const;
