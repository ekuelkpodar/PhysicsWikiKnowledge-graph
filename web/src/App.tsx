import { lazy, Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Shell } from "./components/Shell";
import { EmptyState, LoadingBlock } from "./components/ui";
import { AppProvider } from "./lib/store";
import Story from "./routes/Story";

// Heavy views are code-split so the landing page paints fast.
const Explorer = lazy(() => import("./routes/Explorer"));
const Trees = lazy(() => import("./routes/Trees"));
const Migration = lazy(() => import("./routes/Migration"));
const Institutions = lazy(() => import("./routes/Institutions"));
const Fields = lazy(() => import("./routes/Fields"));
const Recognition = lazy(() => import("./routes/Recognition"));
const MissingLinks = lazy(() => import("./routes/MissingLinks"));
const Quality = lazy(() => import("./routes/Quality"));
const Ask = lazy(() => import("./routes/Ask"));
const About = lazy(() => import("./routes/About"));

function Fallback() {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <LoadingBlock rows={6} />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell>
        <RouteBoundary>
          <Suspense fallback={<Fallback />}>
            <Routes>
              <Route path="/" element={<Story />} />
              <Route path="/graph" element={<Explorer />} />
              <Route path="/trees" element={<Trees />} />
              <Route path="/migration" element={<Migration />} />
              <Route path="/institutions" element={<Institutions />} />
              <Route path="/fields" element={<Fields />} />
              <Route path="/recognition" element={<Recognition />} />
              <Route path="/missing" element={<MissingLinks />} />
              <Route path="/quality" element={<Quality />} />
              <Route path="/ask" element={<Ask />} />
              <Route path="/about" element={<About />} />
              <Route path="*" element={<EmptyState title="Page not found">That view doesn't exist. Try the menu above.</EmptyState>} />
            </Routes>
          </Suspense>
        </RouteBoundary>
      </Shell>
    </AppProvider>
  );
}

function RouteBoundary({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  return <ErrorBoundary resetKey={loc.pathname}>{children}</ErrorBoundary>;
}
