import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { User } from '../api';
import { Badge, Button, Icon, cx, type IconName } from './ui';

interface NavItem { to: string; label: string; icon: IconName; end?: boolean }

function navFor(user: User): NavItem[] {
  if (user.role === 'SUPERINTENDENT') return [{ to: '/', label: 'Centre portal', icon: 'unlock', end: true }];
  const items: NavItem[] = [{ to: '/', label: 'Exams', icon: 'exams', end: true }];
  if (user.role === 'CONTROLLER') items.push({ to: '/centres', label: 'Centres & rooms', icon: 'centres' });
  items.push(
    { to: '/trace', label: 'Trace Lab', icon: 'trace' },
    { to: '/audit', label: 'Audit log', icon: 'audit' },
    { to: '/outbox', label: 'Outbox', icon: 'outbox' },
  );
  return items;
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-md border border-ok/50 bg-ok-tint text-ok shadow-glow-ok"><Icon name="shield" size={20} /></span>
      <span className="font-mono text-lg font-semibold tracking-widest">LEAKTRACE</span>
    </div>
  );
}

function Nav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main">
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end} onClick={onNavigate}
              className={({ isActive }) => cx(
                'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-fast',
                isActive ? 'bg-ok-tint text-ok' : 'text-fg-muted hover:bg-raised hover:text-fg',
              )}>
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppShell({ user, onLogout, children }: { user: User; onLogout: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const items = navFor(user);

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-raised focus:px-4 focus:py-2">
        Skip to main content
      </a>

      <aside className="hidden border-r border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:p-4">
        <div className="mb-8 px-2 pt-2"><Brand /></div>
        <Nav items={items} />
        <p className="mt-auto px-3 pb-2 text-xs text-fg-muted">Every action is logged.</p>
      </aside>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-bg/80 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} aria-hidden />
          <aside id="mobile-nav" aria-label="Navigation menu"
            className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface p-4 shadow-pop lg:hidden">
            <div className="mb-8 flex items-center justify-between px-2 pt-2">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="-m-2 rounded-md p-3 text-fg-muted hover:text-fg"><Icon name="close" /></button>
            </div>
            <Nav items={items} onNavigate={() => setOpen(false)} />
          </aside>
        </>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} aria-controls="mobile-nav"
            className="-ml-2 rounded-md p-3 text-fg-muted hover:text-fg lg:hidden"><Icon name="menu" /></button>
          <div className="lg:hidden"><span className="font-mono text-sm font-semibold tracking-widest">LEAKTRACE</span></div>
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate font-mono text-xs text-fg-muted">{user.email}</p>
            </div>
            <Badge tone={user.role === 'CONTROLLER' ? 'info' : user.role === 'AUDITOR' ? 'warn' : 'ok'}>{user.role}</Badge>
            <Button variant="ghost" icon="signout" onClick={onLogout} aria-label="Sign out" className="px-3 sm:px-4"><span className="hidden sm:inline">Sign out</span></Button>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-page flex-1 px-4 py-6 sm:px-6 sm:py-8 focus:outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
