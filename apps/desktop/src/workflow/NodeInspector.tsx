import type { ChangeEvent, ReactNode } from "react";
import type { ModelProvider, ModelRoute, WorkflowNode } from "@pi-workflow/contracts";
import { useTranslation } from "react-i18next";
import { workflowNodeVisuals } from "./catalog";

interface NodeInspectorProps {
  node?: WorkflowNode;
  modelProviders: ModelProvider[];
  modelRoutes: ModelRoute[];
  onChange: (node: WorkflowNode) => void;
  onDelete: () => void;
}

interface FieldProps {
  label: string;
  children: ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <label className="inspector-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function NodeInspector({ node, modelProviders, modelRoutes, onChange, onDelete }: NodeInspectorProps) {
  const { t } = useTranslation();

  if (!node) {
    return (
      <aside className="builder-inspector is-empty">
        <p className="section-index">{t("builder.inspector.index")}</p>
        <h3>{t("builder.inspector.emptyTitle")}</h3>
        <p>{t("builder.inspector.emptyDescription")}</p>
      </aside>
    );
  }

  const visual = workflowNodeVisuals[node.type];

  function updateName(event: ChangeEvent<HTMLInputElement>) {
    if (!node) return;
    onChange({ ...node, name: event.target.value } as WorkflowNode);
  }

  return (
    <aside className="builder-inspector">
      <div className="inspector-heading">
        <div>
          <p className="section-index">{t("builder.inspector.index")}</p>
          <h3>{node.name.trim() || t(visual.labelKey)}</h3>
        </div>
        <span style={{ "--node-accent": visual.color } as React.CSSProperties}>{visual.icon}</span>
      </div>

      <div className="inspector-form">
        <Field label={t("builder.fields.name")}>
          <input
            onChange={updateName}
            placeholder={t(visual.labelKey)}
            value={node.name}
          />
        </Field>

        <div className="inspector-divider">
          <span>{t("builder.inspector.configuration")}</span>
        </div>

        {renderNodeConfiguration(node, modelProviders, modelRoutes, onChange, t)}
      </div>

      <button className="delete-node-button" onClick={onDelete} type="button">
        {t("builder.deleteNode")}
      </button>
    </aside>
  );
}

function renderNodeConfiguration(
  node: WorkflowNode,
  modelProviders: ModelProvider[],
  modelRoutes: ModelRoute[],
  onChange: (node: WorkflowNode) => void,
  t: (key: string) => string,
) {
  switch (node.type) {
    case "trigger":
      return (
        <>
          <Field label={t("builder.fields.triggerType")}>
            <select
              value={node.config.triggerType}
              onChange={(event) => onChange({
                ...node,
                config: { ...node.config, triggerType: event.target.value as typeof node.config.triggerType },
              })}
            >
              {option("manual", t)}
              {option("webhook", t)}
              {option("schedule", t)}
              {option("api", t)}
            </select>
          </Field>
          {node.config.triggerType === "schedule" && (
            <Field label={t("builder.fields.expression")}>
              <input
                value={node.config.expression ?? ""}
                onChange={(event) => onChange({ ...node, config: { ...node.config, expression: event.target.value } })}
                placeholder="0 9 * * 1-5"
              />
            </Field>
          )}
        </>
      );

    case "pi-agent":
      return (
        <>
          <Field label={t("builder.fields.modelRoute")}>
            <select
              value={node.config.routeId ?? ""}
              onChange={(event) => onChange({ ...node, config: { ...node.config, routeId: event.target.value || undefined } })}
            >
              <option value="">{t("builder.options.directModel")}</option>
              {modelRoutes.map((route) => <option key={route.id} value={route.id}>{route.name || route.id}</option>)}
            </select>
          </Field>
          <Field label={t("builder.fields.directProvider")}>
            <select
              value={node.config.providerId ?? ""}
              onChange={(event) => onChange({ ...node, config: { ...node.config, providerId: event.target.value || undefined, modelId: undefined } })}
            >
              <option value="">{t("builder.options.useRoute")}</option>
              {modelProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name || provider.id}</option>)}
            </select>
          </Field>
          {node.config.providerId && (
            <Field label={t("builder.fields.directModel")}>
              <select
                value={node.config.modelId ?? ""}
                onChange={(event) => onChange({ ...node, config: { ...node.config, modelId: event.target.value || undefined } })}
              >
                <option value="">{t("builder.options.selectModel")}</option>
                {modelProviders.find((provider) => provider.id === node.config.providerId)?.models.map((model) => <option disabled={!model.enabled} key={model.id} value={model.modelId}>{model.displayName || model.modelId}</option>)}
              </select>
            </Field>
          )}
          <Field label={t("builder.fields.agentMode")}>
            <select
              value={node.config.mode}
              onChange={(event) => onChange({ ...node, config: { ...node.config, mode: event.target.value as typeof node.config.mode } })}
            >
              {option("analyze", t)}
              {option("plan", t)}
              {option("implement", t)}
              {option("repair", t)}
              {option("review", t)}
            </select>
          </Field>
          <Field label={t("builder.fields.prompt")}>
            <textarea
              rows={5}
              value={node.config.prompt}
              onChange={(event) => onChange({ ...node, config: { ...node.config, prompt: event.target.value } })}
              placeholder={t("builder.fields.promptPlaceholder")}
            />
          </Field>
          <Field label={t("builder.fields.tools")}>
            <input
              value={node.config.tools.join(", ")}
              onChange={(event) => onChange({
                ...node,
                config: {
                  ...node.config,
                  tools: event.target.value.split(",").map((tool) => tool.trim()).filter(Boolean),
                },
              })}
            />
          </Field>
          <Field label={t("builder.fields.maxTurns")}>
            <input
              min={1}
              max={200}
              type="number"
              value={node.config.maxTurns}
              onChange={(event) => onChange({ ...node, config: { ...node.config, maxTurns: Number(event.target.value) } })}
            />
          </Field>
          <Field label={t("builder.fields.sessionStrategy")}>
            <select
              value={node.config.sessionStrategy}
              onChange={(event) => onChange({ ...node, config: { ...node.config, sessionStrategy: event.target.value as typeof node.config.sessionStrategy } })}
            >
              {option("new", t)}
              {option("continue", t)}
            </select>
          </Field>
        </>
      );

    case "action":
      return (
        <>
          <Field label={t("builder.fields.actionHandler")}>
            <select
              value={node.config.handler}
              onChange={(event) => onChange({ ...node, config: { ...node.config, handler: event.target.value as typeof node.config.handler } })}
            >
              {option("git", t)}
              {option("shell", t)}
              {option("test", t)}
              {option("build", t)}
              {option("http", t)}
              {option("artifact", t)}
              {option("transform", t)}
            </select>
          </Field>
          <Field label={t("builder.fields.command")}>
            <textarea
              rows={4}
              value={node.config.command}
              onChange={(event) => onChange({ ...node, config: { ...node.config, command: event.target.value } })}
            />
          </Field>
          <NumberField
            label={t("builder.fields.timeoutSeconds")}
            value={node.config.timeoutSeconds}
            onChange={(value) => onChange({ ...node, config: { ...node.config, timeoutSeconds: value } })}
          />
        </>
      );

    case "condition":
      return (
        <Field label={t("builder.fields.conditionExpression")}>
          <textarea
            rows={4}
            value={node.config.expression}
            onChange={(event) => onChange({ ...node, config: { expression: event.target.value } })}
          />
        </Field>
      );

    case "loop":
      return (
        <>
          <NumberField
            label={t("builder.fields.maxIterations")}
            min={1}
            max={50}
            value={node.config.maxIterations}
            onChange={(value) => onChange({ ...node, config: { ...node.config, maxIterations: value } })}
          />
          <Field label={t("builder.fields.continueCondition")}>
            <textarea
              rows={3}
              value={node.config.continueCondition}
              onChange={(event) => onChange({ ...node, config: { ...node.config, continueCondition: event.target.value } })}
            />
          </Field>
          <Field label={t("builder.fields.onExhausted")}>
            <select
              value={node.config.onExhausted}
              onChange={(event) => onChange({ ...node, config: { ...node.config, onExhausted: event.target.value as typeof node.config.onExhausted } })}
            >
              {option("fail", t)}
              {option("human", t)}
              {option("continue", t)}
            </select>
          </Field>
        </>
      );

    case "parallel":
      return (
        <>
          <Field label={t("builder.fields.joinStrategy")}>
            <select
              value={node.config.joinStrategy}
              onChange={(event) => onChange({ ...node, config: { ...node.config, joinStrategy: event.target.value as typeof node.config.joinStrategy } })}
            >
              {option("all", t)}
              {option("any", t)}
              {option("first_success", t)}
            </select>
          </Field>
          <Field label={t("builder.fields.failureStrategy")}>
            <select
              value={node.config.failureStrategy}
              onChange={(event) => onChange({ ...node, config: { ...node.config, failureStrategy: event.target.value as typeof node.config.failureStrategy } })}
            >
              {option("fail_fast", t)}
              {option("collect_all", t)}
            </select>
          </Field>
        </>
      );

    case "human":
      return (
        <>
          <Field label={t("builder.fields.humanMode")}>
            <select
              value={node.config.mode}
              onChange={(event) => onChange({ ...node, config: { ...node.config, mode: event.target.value as typeof node.config.mode } })}
            >
              {option("approve", t)}
              {option("input", t)}
              {option("select", t)}
              {option("review_diff", t)}
            </select>
          </Field>
          <Field label={t("builder.fields.title")}>
            <input
              value={node.config.title}
              onChange={(event) => onChange({ ...node, config: { ...node.config, title: event.target.value } })}
            />
          </Field>
          <Field label={t("builder.fields.description")}>
            <textarea
              rows={4}
              value={node.config.description}
              onChange={(event) => onChange({ ...node, config: { ...node.config, description: event.target.value } })}
            />
          </Field>
          <NumberField
            label={t("builder.fields.timeoutHours")}
            min={1}
            value={node.config.timeoutHours ?? 24}
            onChange={(value) => onChange({ ...node, config: { ...node.config, timeoutHours: value } })}
          />
        </>
      );

    case "delay":
      return (
        <>
          <NumberField
            label={t("builder.fields.delayDuration")}
            min={1}
            value={node.config.duration}
            onChange={(value) => onChange({ ...node, config: { ...node.config, duration: value } })}
          />
          <Field label={t("builder.fields.delayUnit")}>
            <select
              value={node.config.unit}
              onChange={(event) => onChange({
                ...node,
                config: { ...node.config, unit: event.target.value as typeof node.config.unit },
              })}
            >
              {option("seconds", t)}
              {option("minutes", t)}
              {option("hours", t)}
            </select>
          </Field>
        </>
      );

    case "wait-event":
      return (
        <>
          <Field label={t("builder.fields.waitType")}>
            <select
              value={node.config.waitType}
              onChange={(event) => onChange({ ...node, config: { ...node.config, waitType: event.target.value as typeof node.config.waitType } })}
            >
              {option("duration", t)}
              {option("datetime", t)}
              {option("webhook", t)}
              {option("external_event", t)}
            </select>
          </Field>
          {node.config.waitType === "duration" ? (
            <NumberField
              label={t("builder.fields.durationSeconds")}
              min={1}
              value={node.config.durationSeconds ?? 60}
              onChange={(value) => onChange({ ...node, config: { ...node.config, durationSeconds: value } })}
            />
          ) : (
            <Field label={t("builder.fields.eventName")}>
              <input
                value={node.config.eventName ?? ""}
                onChange={(event) => onChange({ ...node, config: { ...node.config, eventName: event.target.value } })}
              />
            </Field>
          )}
        </>
      );

    case "subworkflow":
      return (
        <>
          <Field label={t("builder.fields.workflowId")}>
            <input
              value={node.config.workflowId}
              onChange={(event) => onChange({ ...node, config: { ...node.config, workflowId: event.target.value } })}
            />
          </Field>
          <NumberField
            label={t("builder.fields.workflowVersion")}
            min={1}
            value={node.config.workflowVersion}
            onChange={(value) => onChange({ ...node, config: { ...node.config, workflowVersion: value } })}
          />
        </>
      );

    case "end":
      return (
        <Field label={t("builder.fields.endResult")}>
          <select
            value={node.config.result}
            onChange={(event) => onChange({ ...node, config: { result: event.target.value as typeof node.config.result } })}
          >
            {option("success", t)}
            {option("failed", t)}
            {option("cancelled", t)}
            {option("escalated", t)}
          </select>
        </Field>
      );
  }
}

function option(value: string, t: (key: string) => string) {
  return <option value={value}>{t(`builder.options.${value}`)}</option>;
}

function NumberField({
  label,
  value,
  min = 0,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        max={max}
        min={min}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}
