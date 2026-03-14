import { RefreshCw, ShieldCheck, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type QuickActionsProps = {
	onOpenStats: () => void;
};

export default function QuickActions({ onOpenStats }: QuickActionsProps) {
	return (
		<Card className="animate-fade-up">
			<CardHeader>
				<CardTitle className="text-base">Quick Actions</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<Button className="w-full justify-start" variant="secondary">
					<RefreshCw className="mr-2 h-4 w-4" />
					Reload HAProxy Config
				</Button>
				<Button className="w-full justify-start" variant="outline">
					<ShieldCheck className="mr-2 h-4 w-4" />
					Run Health Checks
				</Button>
				<Button
					className="w-full justify-start"
					variant="outline"
					onClick={() => window.open("http://localhost:3000/openapi", "_blank")}
				>
					<TerminalSquare className="mr-2 h-4 w-4" />
					Open API Docs
				</Button>
				<Button
					className="w-full justify-start"
					variant="outline"
					onClick={onOpenStats}
				>
					<TerminalSquare className="mr-2 h-4 w-4" />
					Open HAProxy Stats Tab
				</Button>
			</CardContent>
		</Card>
	);
}
