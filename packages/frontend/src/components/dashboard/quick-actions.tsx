import { TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";

type QuickActionsProps = {
	onOpenStats: () => void;
	onOpenConfigEditor: () => void;
	onOpenLogs: () => void;
};

function resolveBackendOrigin(rawBackendUrl: string) {
	const fallback =
		typeof window === "undefined"
			? "http://localhost:3000"
			: `${window.location.protocol}//${window.location.hostname}:3000`;

	try {
		return new URL(rawBackendUrl).origin;
	} catch {
		try {
			return new URL(`http://${rawBackendUrl}`).origin;
		} catch {
			return new URL(fallback).origin;
		}
	}
}

export default function QuickActions({
	onOpenStats,
	onOpenConfigEditor,
	onOpenLogs,
}: QuickActionsProps) {
	const backendOrigin = resolveBackendOrigin(env.VITE_BACKEND_URL);
	const openApiDocsUrl = new URL("/openapi", backendOrigin).toString();
	const openTelemetryUrl = new URL("/", env.OTEL_DASHBOARD_URL).toString();

	return (
		<Card className="animate-fade-up">
			<CardHeader>
				<CardTitle className="text-base">Quick Actions</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<Button
					className="w-full justify-start"
					variant="outline"
					onClick={onOpenStats}
				>
					<TerminalSquare className="mr-2 h-4 w-4" />
					Open HAProxy Stats Tab
				</Button>
				<Button
					className="w-full justify-start"
					variant="outline"
					onClick={onOpenConfigEditor}
				>
					<TerminalSquare className="mr-2 h-4 w-4" />
					Open Config Editor
				</Button>
				<Button
					className="w-full justify-start"
					variant="outline"
					onClick={onOpenLogs}
				>
					<TerminalSquare className="mr-2 h-4 w-4" />
					Open Log Viewer
				</Button>
				<Button
					className="w-full justify-start"
					variant="outline"
					onClick={() => window.open(openApiDocsUrl, "_blank")}
				>
					<TerminalSquare className="mr-2 h-4 w-4" />
					Open API Docs
				</Button>
				<Button
					className="w-full justify-start"
					variant="outline"
					onClick={() => window.open(openTelemetryUrl, "_blank")}
				>
					<TerminalSquare className="mr-2 h-4 w-4" />
					Open Telemetry UI
				</Button>
			</CardContent>
		</Card>
	);
}
