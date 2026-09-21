import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { SessionList } from "./components/SessionList";
import { SessionView } from "./components/SessionView";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<SessionList />} />
          <Route path="/session/:id" element={<SessionView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
