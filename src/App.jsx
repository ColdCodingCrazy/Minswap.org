import "./App.css";
import { Route, Routes } from "react-router";
import Home from "./Pages/Home";
import Nami from "./Components/Nami";
import Eternl from "./Components/Eternl";
import EternlAddWallet from "./Components/EternlAddWallet";
import EternlRestoreWallet from "./Components/EternlRestoreWallet";
import NamiNewWallet from "./Components/NamiNewWallet";
import Market from "./Pages/Market";

function App() {
  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/nami" element={<Nami />} />
        <Route path="/namiWallet" element={<NamiNewWallet />} />
        <Route path="/eternl" element={<Eternl />} />
        <Route path="/eternlAddWallet" element={<EternlAddWallet />} />
        <Route path="/eternlRestoreWallet" element={<EternlRestoreWallet />} />
        <Route path="/market" element={<Market />} />
      </Routes>
    </div>
  );
}

export default App;
