import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

type AppErrorBoundaryProps = {
	children: React.ReactNode;
};

type AppErrorBoundaryState = {
	hasError: boolean;
	errorMessage: string;
};

class AppErrorBoundary extends React.Component<
	AppErrorBoundaryProps,
	AppErrorBoundaryState
> {
	override state: AppErrorBoundaryState = {
		hasError: false,
		errorMessage: "",
	};

	static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
		const message = error instanceof Error ? error.message : String(error);
		return {
			hasError: true,
			errorMessage: message,
		};
	}

	override componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
		console.group("[runtime] React render error");
		console.error(error);
		console.error(errorInfo.componentStack);
		console.groupEnd();
	}

	override render() {
		if (this.state.hasError) {
			return (
				<div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
					<div className="w-full max-w-xl rounded-lg border border-red-300 bg-red-50 p-5 text-red-800">
						<h1 className="text-lg font-semibold">Application crashed</h1>
						<p className="mt-2 text-sm">
							Open browser console to see stack trace and error details.
						</p>
						<p className="mt-3 rounded bg-white/80 px-3 py-2 font-mono text-xs">
							{this.state.errorMessage || "Unknown runtime error"}
						</p>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}

if (typeof window !== "undefined") {
	window.addEventListener("error", (event) => {
		console.group("[runtime] Uncaught error event");
		console.error("message:", event.message);
		console.error("source:", event.filename);
		console.error("line:", event.lineno, "column:", event.colno);
		console.error("error:", event.error);
		console.groupEnd();
	});

	window.addEventListener("unhandledrejection", (event) => {
		console.group("[runtime] Unhandled promise rejection");
		console.error(event.reason);
		console.groupEnd();
	});
}

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
	<React.StrictMode>
		<AppErrorBoundary>
			<App />
		</AppErrorBoundary>
	</React.StrictMode>,
);
