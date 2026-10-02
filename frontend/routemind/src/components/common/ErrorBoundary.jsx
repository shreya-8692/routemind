import { Component } from 'react';
import { DISCLAIMER } from '../../constants/emergency';

/**
 * Keeps a rendering failure from blanking the screen. `compact` is used around
 * the map so the route panel stays usable if the map itself fails.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Developer diagnostics only; contains no location data.
    console.error('RouteMind UI error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.compact) {
      return (
        <div className="boundary boundary--compact" role="alert">
          <strong>The map could not be displayed.</strong>
          <p>Route information below is still available.</p>
          <button type="button" className="btn btn-small" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return (
      <div className="page page--narrow" role="alert">
        <h1>Something went wrong</h1>
        <p>RouteMind hit an unexpected error. Your current trip is saved in this browser session; reloading should restore it.</p>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload RouteMind</button>
          <a className="btn" href="/">Home</a>
        </div>
        <p className="disclaimer">{DISCLAIMER}</p>
      </div>
    );
  }
}
