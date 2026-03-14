import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
	const statsCards = [
		"stats-card-1",
		"stats-card-2",
		"stats-card-3",
		"stats-card-4",
	];
	const activityRows = [
		"activity-row-1",
		"activity-row-2",
		"activity-row-3",
		"activity-row-4",
		"activity-row-5",
	];
	const overviewRows = [
		"overview-row-1",
		"overview-row-2",
		"overview-row-3",
		"overview-row-4",
	];

	return (
		<div className="space-y-6">
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{statsCards.map((key) => (
					<div key={key} className="rounded-xl border bg-card p-4">
						<Skeleton className="mb-3 h-4 w-28" />
						<Skeleton className="h-8 w-20" />
						<Skeleton className="mt-4 h-3 w-32" />
					</div>
				))}
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<div className="rounded-xl border bg-card p-4 lg:col-span-2">
					<Skeleton className="mb-4 h-5 w-44" />
					<div className="space-y-3">
						{activityRows.map((key) => (
							<Skeleton key={key} className="h-12 w-full" />
						))}
					</div>
				</div>
				<div className="rounded-xl border bg-card p-4">
					<Skeleton className="mb-4 h-5 w-28" />
					<div className="space-y-3">
						{overviewRows.map((key) => (
							<Skeleton key={key} className="h-9 w-full" />
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
