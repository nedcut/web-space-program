import { useEffect, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

/** Native semantics and all data/ARIA hooks are preserved by these shared primitives. */
export function Button({ className = 'btn', variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return <button type="button" className={`${className}${variant ? ` ${variant}` : ''}`} {...props} />;
}
export function Panel({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`panel ${className}`} {...props} />;
}
export function Card({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <article className={`panel ui-card ${className}`} {...props} />;
}
export function Badge({ className = '', ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={`ui-badge ${className}`} {...props} />;
}
/** A native-button segmented control; selection is exposed without inventing tab panels. */
export function Segmented<T extends string>({ label, options, value, onChange, className = '' }: { label: string; options: readonly T[]; value: T; onChange: (value: T) => void; className?: string }) {
  return <div className={`seg ${className}`} role="group" aria-label={label}>{options.map(option => <Button key={option} className={value === option ? 'on' : ''} aria-pressed={value === option} onClick={() => onChange(option)}>{option}</Button>)}</div>;
}
export function Slider(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <input {...props} type="range" className={`ui-slider ${props.className ?? ''}`} />;
}
export function Toggle(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <input {...props} type="checkbox" role="switch" className={`ui-toggle ${props.className ?? ''}`} />;
}
/** Tooltips are visible to keyboard users too; keep the child control's accessible name. */
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return <span className="ui-tooltip" data-tooltip={text}>{children}</span>;
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <Panel className="ui-empty"><div className="ui-empty-orbit" aria-hidden="true" /><h2>{title}</h2><p>{children}</p></Panel>;
}
export function Modal({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={`panel ui-modal ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}><div className="ui-modal-heading"><h2>{title}</h2><Button className="btn ghost small" onClick={onClose}>Close</Button></div>{children}</dialog>;
}

export function Tabs<T extends string>({ label, options, value, onChange, panelId, className = '' }: { label: string; options: readonly T[]; value: T; onChange: (value: T) => void; panelId: string; className?: string }) {
  return <div role="tablist" aria-label={label} className={`seg ${className}`} onKeyDown={event => {
    const index = options.indexOf(value);
    const next = event.key === 'ArrowRight' ? (index + 1) % options.length : event.key === 'ArrowLeft' ? (index + options.length - 1) % options.length : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); onChange(options[next]);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  }}>{options.map(option => <Button role="tab" aria-selected={value === option} aria-controls={panelId} tabIndex={value === option ? 0 : -1} key={option} className={value === option ? 'on' : ''} onClick={() => onChange(option)}>{option}</Button>)}</div>;
}
