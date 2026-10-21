/**
 * Mounts one lazy panel: its code is fetched on the first open (never
 * prefetched), it unmounts on close unless `keepAlive`, and an error boundary
 * keeps a throwing panel from taking the app down.
 */
import {
  Component,
  lazy,
  Suspense,
  useRef,
  useState,
  type LazyExoticComponent,
  type ComponentProps,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";

interface BoundaryProps {
  id: string;
  onRetry: () => void;
  onClose?: () => void;
  children: ReactNode;
}

class PanelBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`panel "${this.props.id}" failed:`, error, info);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <div className="vault-panel-error" role="alert">
        <span>This panel failed to load.</span>
        <button
          type="button"
          className="vault-btn vault-btn--ghost vault-btn--sm"
          onClick={this.props.onRetry}
        >
          Retry
        </button>
        {this.props.onClose && (
          <button
            type="button"
            className="vault-btn vault-btn--ghost vault-btn--sm"
            onClick={this.props.onClose}
          >
            Close
          </button>
        )}
      </div>
    );
  }
}

const LAZY_BY_LOAD = new WeakMap<
  () => Promise<unknown>,
  LazyExoticComponent<ComponentType<any>>
>();

export interface PanelHostProps<P extends object> {
  id: string;
  /** Dynamic import of the panel; called once, on the first open. */
  load: () => Promise<{ default: ComponentType<P> }>;
  open: boolean;
  /** Stay mounted (hidden) after the first open instead of unmounting. */
  keepAlive?: boolean;
  fallback?: ReactNode;
  /** Close button of the error UI. */
  onClose?: () => void;
  props: P;
}

export function PanelHost<P extends object>({
  id,
  load,
  open,
  keepAlive = false,
  fallback = null,
  onClose,
  props,
}: PanelHostProps<P>) {
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  // Created on the first open, so a closed panel costs nothing. Shared per
  // `load` across host remounts (a resolved lazy never suspends again); a new
  // one on Retry, since React.lazy caches a failed import.
  const lazyRef = useRef<{
    attempt: number;
    Panel: LazyExoticComponent<ComponentType<P>>;
  } | null>(null);
  if (open && lazyRef.current?.attempt !== attempt) {
    const shared = attempt === 0 ? LAZY_BY_LOAD.get(load) : undefined;
    const Panel =
      (shared as LazyExoticComponent<ComponentType<P>> | undefined) ??
      lazy<ComponentType<P>>(() => loadRef.current());
    LAZY_BY_LOAD.set(load, Panel as LazyExoticComponent<ComponentType<any>>);
    lazyRef.current = { attempt, Panel };
  }
  const Panel = lazyRef.current?.Panel;
  if (!Panel || (!open && !keepAlive)) {
    return null;
  }
  // The boundary unmounts with a closed panel, so reopening clears an error.
  const content = (
    <PanelBoundary
      key={attempt}
      id={id}
      onRetry={() => setAttempt((n) => n + 1)}
      onClose={onClose}
    >
      <Suspense fallback={fallback}>
        <Panel {...(props as ComponentProps<typeof Panel>)} />
      </Suspense>
    </PanelBoundary>
  );
  return keepAlive ? <div hidden={!open}>{content}</div> : content;
}
