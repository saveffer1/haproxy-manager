import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App"; // ชี้ไปที่ App.tsx ของคุณ

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
