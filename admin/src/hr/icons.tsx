import { SVGProps, ReactNode } from 'react';

const make = (path: ReactNode) =>
  (props: SVGProps<SVGSVGElement> = {}) => (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      {path}
    </svg>
  );

export const I = {
  Search:   make(<><circle cx="7" cy="7" r="4.5" /><path d="m13.5 13.5-3-3" /></>),
  Home:     make(<path d="M2.5 8 8 3l5.5 5v5a1 1 0 0 1-1 1H9v-4H7v4H3.5a1 1 0 0 1-1-1V8Z" />),
  Book:     make(<><path d="M3 3v10a1 1 0 0 0 1 1h9V2H4a1 1 0 0 0-1 1Z" /><path d="M6 5h5M6 8h5" /></>),
  Doc:      make(<><path d="M4 1.5h5L12.5 5v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5v-12a.5.5 0 0 1 .5-.5Z" /><path d="M9 1.5V5h3.5" /></>),
  Tag:      make(<><path d="M2.5 6V2.5H6L13.5 10 10 13.5 2.5 6Z" /><circle cx="5" cy="5" r=".8" fill="currentColor" /></>),
  Inbox:    make(<><path d="M2 3h12v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3Z" /><path d="M2 9h3l1 1.5h4L11 9h3" /></>),
  Bolt:     make(<path d="M9 1 3 9h4l-1 6 6-8H8l1-6Z" />),
  Sparkle:  make(<><path d="M8 2v3M8 11v3M2 8h3M11 8h3" /><path d="m4.5 4.5 2 2M9.5 9.5l2 2M4.5 11.5l2-2M9.5 6.5l2-2" /></>),
  Gear:     make(<><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8 3.4 3.4" /></>),
  People:   make(<><circle cx="6" cy="5" r="2.3" /><path d="M2 13c.4-2.3 2-3.5 4-3.5s3.6 1.2 4 3.5" /><circle cx="11.5" cy="6" r="1.8" /><path d="M10 13c.3-1.8 1.4-2.8 3-2.8" /></>),
  Calendar: make(<><rect x="2" y="3" width="12" height="11" rx="1" /><path d="M2 6h12M5 1.5v3M11 1.5v3" /></>),
  Eye:      make(<><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" /></>),
  Clock:    make(<><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></>),
  Plus:     make(<path d="M8 3v10M3 8h10" />),
  Upload:   make(<><path d="M8 11V2.5M5 5.5 8 2.5 11 5.5" /><path d="M2.5 11v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" /></>),
  Check:    make(<path d="m3 8 3.5 3.5L13 4.5" />),
  X:        make(<path d="m4 4 8 8M12 4l-8 8" />),
  Filter:   make(<path d="M2 3h12L9.5 8.5V13L6.5 11.5V8.5L2 3Z" />),
  Sort:     make(<><path d="M4 3v10M4 13l-2-2M4 13l2-2" /><path d="M12 13V3M12 3l-2 2M12 3l2 2" /></>),
  Chevron:  make(<path d="m6 4 4 4-4 4" />),
  ChevronD: make(<path d="m4 6 4 4 4-4" />),
  Bell:     make(<><path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3L4 11Z" /><path d="M6.5 14a1.5 1.5 0 0 0 3 0" /></>),
  Sidebar:  make(<><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M6 3v10" /></>),
  Warning:  make(<><path d="M8 2 14.5 13H1.5L8 2Z" /><path d="M8 7v3M8 12v.5" /></>),
  Flame:    make(<path d="M8 14c2.8 0 5-2.2 5-5 0-2-1.2-3.2-2-4-.5 1.5-1.5 2-2 2-.5-2 1-3.5 1-5-2 1-5 3.5-5 7 0 2.8 1.2 5 3 5Z" />),
  Layers:   make(<><path d="m2 5 6-3 6 3-6 3-6-3Z" /><path d="m2 8 6 3 6-3M2 11l6 3 6-3" /></>),
  Link:     make(<><path d="M7 9 5 11a2.5 2.5 0 0 1-3.5-3.5L4 5" /><path d="m9 7 2-2a2.5 2.5 0 0 1 3.5 3.5L12 11" /><path d="m6 10 4-4" /></>),
  Arrow:    make(<path d="M3 8h10M9 4l4 4-4 4" />),
  External: make(<><path d="M6 3h7v7" /><path d="M13 3 7 9M11 8v5H3V5h5" /></>),
  History:  make(<><path d="M2.5 6a5.5 5.5 0 1 1 .8 4" /><path d="M2 9 3 6l3 1" /><path d="M8 5v3.5l2.5 1.5" /></>),
  Comment:  make(<><path d="M2 3h12v8a1 1 0 0 1-1 1H7l-3.5 2.5V12H3a1 1 0 0 1-1-1V3Z" /></>),
  Refresh:  make(<><path d="M2.5 8a5.5 5.5 0 0 1 9.5-3.8" /><path d="M12 2v3h-3" /><path d="M13.5 8a5.5 5.5 0 0 1-9.5 3.8" /><path d="M4 14v-3h3" /></>),
  Brain:    make(<><path d="M6 3a2.5 2.5 0 0 0-2 4 2.5 2.5 0 0 0 2 4.5V13a1 1 0 0 0 2 0V3a1 1 0 0 0-2 0Z" /><path d="M10 3a2.5 2.5 0 0 1 2 4 2.5 2.5 0 0 1-2 4.5V13a1 1 0 0 1-2 0V3" /></>),
};
