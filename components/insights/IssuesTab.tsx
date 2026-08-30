'use client';

import { healthClaim } from '@wellkept/core/health-claims';
import IssueCard from '@/components/IssueCard';

interface Issue {
  part: string;
  severity: string;
  description?: string;
  [key: string]: unknown;
}

interface IssueTracking {
  issue_identifier: string;
  status: string;
}

interface IssuesTabProps {
  issues: Issue[];
  vehicleId: string;
  issueTracking: IssueTracking[];
  savedItemNames: Set<string>;
  loading: boolean;
  onMarkFixed: (issueId: string, issueName: string) => void;
  onNotApplicable: (issueIdentifier: string, status: 'pending' | 'completed' | 'not_interested') => Promise<void>;
  onWishlistToggleComplete: () => Promise<void>;
  /**
   * Whether research reached `completed` for this vehicle.
   *
   * ⚠ Required rather than defaulted, and that is the point of adding it.
   * `VehicleInsights` returns early for `pending`, `failed` and `unsupported`,
   * so this component only ever rendered for a researched car — and "No known
   * issues for this vehicle" was therefore true. **By an upstream coupling
   * nothing here stated.** Move this tab, render it from a second place, or
   * relax that early return, and an unresearched car is told it has no known
   * issues, which is absence reported as a finding.
   *
   * Passing the evidence makes the guarantee explicit instead of ambient.
   */
  researchComplete: boolean;
}

function getSeverityColor(severity: string) {
  switch (severity) {
    case 'High': return 'destructive';
    case 'Medium': return 'default';
    case 'Low': return 'secondary';
    default: return 'secondary';
  }
}

export default function IssuesTab({
  issues,
  vehicleId,
  issueTracking,
  savedItemNames,
  loading,
  onMarkFixed,
  onNotApplicable,
  onWishlistToggleComplete,
  researchComplete,
}: IssuesTabProps) {
  const getIssueStatus = (issueIdentifier: string) =>
    issueTracking.find(t => t.issue_identifier === issueIdentifier);

  if (issues.length === 0) {
    /*
      The copy comes from `health-claims.ts` rather than from this file, so the
      three states stay one decision. `issues` empty means "researched and
      found none" only when research actually completed.
    */
    return (
      <p className="text-sm text-white/60 text-center py-8">
        {healthClaim('issues', '', researchComplete).text}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {issues.map((issue, index) => {
        const issueId = `${issue.part}-${index}`;
        const tracking = getIssueStatus(issueId);
        const isCompleted = tracking?.status === 'completed';
        const isNotInterested = tracking?.status === 'not_interested';

        return (
          <IssueCard
            key={issueId}
            issue={issue}
            issueId={issueId}
            vehicleId={vehicleId}
            isCompleted={isCompleted}
            isNotInterested={isNotInterested}
            isInWishlist={savedItemNames.has(issue.part)}
            onMarkFixed={onMarkFixed}
            onNotApplicable={onNotApplicable}
            onWishlistToggleComplete={onWishlistToggleComplete}
            getSeverityColor={getSeverityColor}
            size="md"
            loading={loading}
          />
        );
      })}
    </div>
  );
}
