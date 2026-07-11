import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const MenuIcon = (props: IconProps) => <svg {...base} {...props}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
export const SidebarIcon = (props: IconProps) => <svg {...base} {...props}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>;
export const PlusIcon = (props: IconProps) => <svg {...base} {...props}><path d="M12 5v14M5 12h14" /></svg>;
export const ChatIcon = (props: IconProps) => <svg {...base} {...props}><path d="M21 12a8 8 0 0 1-8 8H5l-2 2v-6a8 8 0 1 1 18-4Z" /></svg>;
export const PlanIcon = (props: IconProps) => <svg {...base} {...props}><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" /></svg>;
export const GoalIcon = (props: IconProps) => <svg {...base} {...props}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="m15 9 5-5" /></svg>;
export const WorkflowIcon = (props: IconProps) => <svg {...base} {...props}><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M7 6h10M6.5 8l4.5 8M17.5 8 13 16" /></svg>;
export const FileIcon = (props: IconProps) => <svg {...base} {...props}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /></svg>;
export const CloseIcon = (props: IconProps) => <svg {...base} {...props}><path d="m6 6 12 12M18 6 6 18" /></svg>;
