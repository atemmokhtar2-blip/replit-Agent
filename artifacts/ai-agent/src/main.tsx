import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { getAccessToken } from "./lib/token-manager";

setAuthTokenGetter(getAccessToken);

createRoot(document.getElementById("root")!).render(<App />);
