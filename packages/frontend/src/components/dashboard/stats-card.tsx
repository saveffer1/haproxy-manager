import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatsCardProps = {
	title: string;
	value: string;
	hint: string;
	state?: "ok" | "warn" | "neutral";
};

export function StatsCard({
	title,
	value,
	hint,
	state = "neutral",
}: StatsCardProps) {
	return (
		<Card className="animate-fade-up">
			<CardHeader>
				<CardTitle className="text-sm font-medium text-muted-foreground">
					{title}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<p className="text-3xl font-bold tracking-tight text-foreground">
					{value}
				</p>
				<p
					className={cn(
						"mt-2 text-sm",
						state === "ok" && "text-emerald-600 dark:text-emerald-400",
						state === "warn" && "text-amber-600 dark:text-amber-400",
						state === "neutral" && "text-muted-foreground",
					)}
				>
					{hint}
				</p>
			</CardContent>
		</Card>
	);
}
