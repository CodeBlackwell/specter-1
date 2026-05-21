import type React from "react";

const REPO_BLOB = "https://github.com/CodeBlackwell/specter-1/blob/main";
const REPO_TREE = "https://github.com/CodeBlackwell/specter-1/tree/main";

const ADR_SLUGS: Record<string, string> = {
  "0001": "0001-pure-python-sim-first",
  "0002": "0002-ecdsa-and-beta-reputation",
  "0003": "0003-canonical-json-then-protobuf",
  "0004": "0004-local-slam-choice",
  "0005": "0005-sensor-realism-budget",
  "0006": "0006-target-platform",
  "0007": "0007-scan-match-radial-flow",
  "0008": "0008-time-sync-skew",
  "0009": "0009-attestation-interface",
  "0010": "0010-map-merger-occupancy-voting",
  "0011": "0011-sros2-transport-and-marshalling",
  "0012": "0012-per-topic-qos-profiles",
  "0013": "0013-decay-window-calibration",
  "0014": "0014-workshop-notebooks-as-audit-surface",
  "0015": "0015-range-only-trust-voting",
  "0016": "0016-pose-graph-substrate-and-trust-slam-contract",
  "0017": "0017-loop-closure-detection",
  "0018": "0018-reputation-as-factor-information-prior",
  "0019": "0019-python-map-attack-mechanism",
  "0020": "0020-bidirectional-trust-slam-coupling",
  "0021": "0021-slam-lessons-on-tick-rail",
};

export const adrPath = (n: string): string =>
  `docs/adr/${ADR_SLUGS[n] ?? n}.md`;

export const adrUrl = (n: string): string => `${REPO_BLOB}/${adrPath(n)}`;

const BARE_DOCS: Record<string, string> = {
  "THREAT_MODEL.md": "docs/THREAT_MODEL.md",
  "HARDWARE_READINESS.md": "docs/HARDWARE_READINESS.md",
  "PROGRESS.md": "docs/PROGRESS.md",
  "RUNBOOK.md": "docs/RUNBOOK.md",
  "BASELINES.md": "docs/BASELINES.md",
};

export const blobUrl = (path: string, section?: string): string =>
  `${REPO_BLOB}/${path}${section ? `#${section.toLowerCase()}` : ""}`;

export const treeUrl = (path: string): string => `${REPO_TREE}/${path}`;

const REFS_RE = new RegExp(
  [
    String.raw`(?<adrLead>ADRs?\s+)(?<adrNums>\d{4}(?:[\s,;–\-]+\d{4})*)`,
    String.raw`(?<path>(?:tests\/eval|tests|examples|notebooks|experiments|src\/specter|ui\/packages\/sim-core|ui\/packages\/app|docs\/adr|docs)\/[\w./\-]+\.(?:py|md|ipynb|ts|tsx|json|yml|yaml))(?<anchor>::[A-Za-z_]\w*)?`,
    String.raw`(?<bare>THREAT_MODEL\.md|HARDWARE_READINESS\.md|PROGRESS\.md|RUNBOOK\.md|BASELINES\.md)(?:\s*§\s*(?<bareSec>[A-Za-z0-9][\w-]*))?`,
    String.raw`(?<tree>tests\/eval|docs\/adr|ui\/packages\/sim-core|ui\/packages\/app)(?=[\s./,;:)]|$)`,
  ].join("|"),
  "g",
);

/** Linkifies internal references (ADRs, file paths, doc names, ::test anchors,
 * § section anchors) to their GitHub URLs. Both forms render the matched
 * file-path text as the link label so the parenthetical is self-explanatory. */
export function LinkifyRefs({
  text,
  className = "ref-link",
}: {
  text: string;
  className?: string;
}) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(REFS_RE)) {
    const idx = match.index!;
    const g = match.groups!;
    if (idx > last) out.push(text.slice(last, idx));

    if (g.adrLead) {
      out.push(g.adrLead);
      const numbers = g.adrNums!;
      const nre = /\d{4}/g;
      let prev = 0;
      let nm: RegExpExecArray | null;
      while ((nm = nre.exec(numbers)) !== null) {
        if (nm.index > prev) out.push(numbers.slice(prev, nm.index));
        const n = nm[0];
        out.push(
          <a
            key={`adr-${key++}`}
            className={className}
            href={adrUrl(n)}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${adrPath(n)} on GitHub`}
          >
            {n}
          </a>,
        );
        prev = nm.index + n.length;
      }
      if (prev < numbers.length) out.push(numbers.slice(prev));
    } else if (g.path) {
      const path = g.path;
      const anchor = g.anchor ?? "";
      out.push(
        <a
          key={`ref-${key++}`}
          className={className}
          href={blobUrl(path)}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open ${path} on GitHub`}
        >
          {path}
          {anchor}
        </a>,
      );
    } else if (g.bare) {
      const bare = g.bare;
      const section = g.bareSec;
      out.push(
        <a
          key={`ref-${key++}`}
          className={className}
          href={blobUrl(BARE_DOCS[bare]!, section)}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open ${bare}${section ? ` § ${section}` : ""} on GitHub`}
        >
          {bare}
          {section ? ` § ${section}` : ""}
        </a>,
      );
    } else if (g.tree) {
      out.push(
        <a
          key={`ref-${key++}`}
          className={className}
          href={treeUrl(g.tree)}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open ${g.tree}/ on GitHub`}
        >
          {g.tree}
        </a>,
      );
    }

    last = idx + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
