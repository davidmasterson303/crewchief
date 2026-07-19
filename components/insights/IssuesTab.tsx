'use client';

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
}: IssuesTabProps) {
  const getIssueStatus = (issueIdentifier: string) =>
    issueTracking.find(t => t.issue_identifier === issueIdentifier);

  if (issues.length === 0) {
    return <p className="text-sm text-white/60 text-center py-8">No known issues for this vehicle.</p>;
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
