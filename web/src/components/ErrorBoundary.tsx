import { Component, type ReactNode } from "react";
import { ErrorState } from "./ui";

/** Keeps a crash in one page from blanking the whole app shell. Reset by changing `resetKey` (the route). */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    return this.state.error ? <ErrorState error={this.state.error} /> : this.props.children;
  }
}
