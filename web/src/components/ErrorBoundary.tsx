import { Component, type ReactNode } from "react";
import { Button, EmptyState } from "./ui";

/** Keeps one broken view from blanking the whole app. Reset when the route changes. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  componentDidCatch(error: Error) {
    console.error("view crashed:", error);
  }
  render() {
    if (this.state.error)
      return (
        <EmptyState
          title="This view hit a snag"
          action={
            <Button variant="outline" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
          }
        >
          {this.state.error.message}. The rest of the site still works; pick another view above.
        </EmptyState>
      );
    return this.props.children;
  }
}
