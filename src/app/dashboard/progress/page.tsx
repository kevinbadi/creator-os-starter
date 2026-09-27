import { PageHeader } from "@/components/PageHeader";
import { listGoals } from "@/lib/goals/store";
import { computeGoalMetrics } from "@/lib/goals/metrics";
import { listAccomplishments } from "@/lib/accomplishments/store";
import { GoalManager } from "./GoalManager";
import { AccomplishmentsCalendar } from "./AccomplishmentsCalendar";

export const metadata = { title: "Business Progress · Marketing OS" };

export default async function ProgressPage() {
  const goals = await listGoals();
  const metrics = await computeGoalMetrics(goals);
  const accomplishments = await listAccomplishments();

  return (
    <main className="w-full px-6 pb-6 pt-4">
      <PageHeader
        title="Overall Business Progress"
        description="Your goals, timelines, and how close you are to hitting them."
      />
      <GoalManager goals={goals} metrics={metrics} />
      <AccomplishmentsCalendar items={accomplishments} />
    </main>
  );
}
