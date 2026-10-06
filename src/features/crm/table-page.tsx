import {
  ChartColumnIcon,
  PlusIcon,
  Settings2Icon,
  SquareKanbanIcon,
  Table2Icon,
  UploadIcon,
} from "lucide-react";
import { useState } from "react";
import { Redirect, useLocation, useSearchParams } from "wouter";

import { IconButton } from "@/components/icon-button";
import { ProjectAvatar } from "@/components/project-avatar";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CrmScope } from "@/features/crm/crm-context";
import { CrmContext, recordPath, tablePath } from "@/features/crm/crm-context";
import { ImportDialog } from "@/features/crm/import-dialog";
import { InsightsView } from "@/features/crm/insights-view";
import { NewRecordDialog } from "@/features/crm/new-record-dialog";
import { PipelineView } from "@/features/crm/pipeline-view";
import { RecordSheet } from "@/features/crm/record-sheet";
import { RecordsView } from "@/features/crm/records-view";
import { TableIcon } from "@/features/crm/table-icon";
import { TableSettingsDialog } from "@/features/crm/table-settings-dialog";
import type { CrmRecord, CrmTable, ProjectContent } from "@/lib/crm";
import { stageField } from "@/lib/crm";
import type { Project } from "@/lib/project";

const VIEWS = ["table", "pipeline", "insights"] as const;
const DEFAULT_VIEW = "table";

type View = (typeof VIEWS)[number];
type Dialog = "new" | "settings" | "import";

function parseView(value: string | null, hasStages: boolean): View {
  const view = VIEWS.find((item) => item === value) ?? DEFAULT_VIEW;
  return view === "pipeline" && !hasStages ? DEFAULT_VIEW : view;
}

// Keeps the last opened record so the sheet can slide out after it closes.
function useSelectedRecord(records: CrmRecord[], id: string | undefined) {
  const [last, setLast] = useState<CrmRecord>();
  const selected = id ? records.find((record) => record.id === id) : undefined;
  if (selected && selected.event !== last?.event) {
    setLast(selected);
  }
  return { selected, shown: selected ?? last };
}

interface TablePageProps {
  project: Project;
  content: ProjectContent;
  table: CrmTable;
  recordId?: string;
  pubkey: string;
  loaded: boolean;
}

export function TablePage({
  project,
  content,
  table,
  recordId,
  pubkey,
  loaded,
}: TablePageProps) {
  const [params, setParams] = useSearchParams();
  const [, navigate] = useLocation();
  const [dialog, setDialog] = useState<Dialog>();
  const records = content.byTable.get(table.id) ?? [];
  const hasStages = stageField(table) !== undefined;
  const view = parseView(params.get("view"), hasStages);
  const query = new URLSearchParams(view === DEFAULT_VIEW ? {} : { view });
  const search = query.toString();
  const tableHref = `${tablePath(project, table)}${search ? `?${search}` : ""}`;
  const { selected, shown } = useSelectedRecord(records, recordId);

  const scope: CrmScope = {
    content,
    project,
    pubkey,
    recordHref: (record) => recordPath(project, table, record, query),
    records,
    table,
  };

  const showView = (next: View) =>
    setParams(next === DEFAULT_VIEW ? {} : { view: next });
  const openDialog = (next: Dialog) => () => setDialog(next);
  const dialogProps = (name: Dialog) => ({
    onOpenChange: (open: boolean) => setDialog(open ? name : undefined),
    open: dialog === name,
  });

  const closeRecord = () => {
    if (history.state?.fromTable) {
      history.back();
    } else {
      navigate(tableHref, { replace: true });
    }
  };

  return (
    <CrmContext value={scope}>
      <TopBar
        crumbs={[
          {
            href: `/p/${project.slug}`,
            icon: <ProjectAvatar project={project} />,
            label: project.title,
          },
          {
            icon: (
              <TableIcon
                className="text-muted-foreground size-4 shrink-0"
                icon={table.icon}
              />
            ),
            label: table.title,
          },
        ]}
      />
      <main className="flex grow flex-col px-4 pb-10 sm:px-6">
        <Tabs className="grow gap-4" onValueChange={showView} value={view}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="table">
                <Table2Icon className="size-4" />
                Table
              </TabsTrigger>
              {hasStages && (
                <TabsTrigger value="pipeline">
                  <SquareKanbanIcon className="size-4" />
                  Pipeline
                </TabsTrigger>
              )}
              <TabsTrigger value="insights">
                <ChartColumnIcon className="size-4" />
                Insights
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-1">
              <FluidTooltip.Group>
                <IconButton label="Import CSV" onClick={openDialog("import")}>
                  <UploadIcon />
                </IconButton>
                <IconButton
                  label="Table settings"
                  onClick={openDialog("settings")}
                >
                  <Settings2Icon />
                </IconButton>
              </FluidTooltip.Group>
              <Button className="ml-1" onClick={openDialog("new")}>
                <PlusIcon />
                <span className="max-sm:sr-only">
                  New {table.singular.toLowerCase()}
                </span>
              </Button>
            </div>
          </div>
          <TabsContent className="flex flex-col" value="table">
            <RecordsView
              onCreate={openDialog("new")}
              onImport={openDialog("import")}
            />
          </TabsContent>
          {hasStages && (
            <TabsContent className="flex flex-col" value="pipeline">
              <PipelineView />
            </TabsContent>
          )}
          <TabsContent className="flex flex-col" value="insights">
            <InsightsView />
          </TabsContent>
        </Tabs>
      </main>
      {shown && (
        <RecordSheet
          onClose={closeRecord}
          open={selected !== undefined}
          record={shown}
        />
      )}
      {loaded && recordId && !shown && <Redirect replace to={tableHref} />}
      <NewRecordDialog {...dialogProps("new")} />
      <TableSettingsDialog {...dialogProps("settings")} />
      <ImportDialog {...dialogProps("import")} />
    </CrmContext>
  );
}
