export const Actions = {
	ProjectRead: "project.read",
	ProjectCreate: "project.create",
	ProjectAdmin: "project.admin",
	AssistantAsk: "assistant.ask",
	RunbookEdit: "runbook.edit",
	DeploymentRead: "deployment.read",
	DeploymentCreate: "deployment.create",
	IncidentManage: "incident.manage",
	IntegrationManage: "integration.manage",
	UserRead: "user.read",
	UserManage: "user.manage",
	PipelineRun: "pipeline.run",
	PipelineManage: "pipeline.manage",
} as const;

export type Action = (typeof Actions)[keyof typeof Actions];

const ROLE_PERMISSIONS: Record<string, Action[]> = {
	SUPER_ADMIN: [
		Actions.ProjectRead,
		Actions.ProjectCreate,
		Actions.ProjectAdmin,
		Actions.AssistantAsk,
		Actions.RunbookEdit,
		Actions.DeploymentRead,
		Actions.DeploymentCreate,
		Actions.IncidentManage,
		Actions.IntegrationManage,
		Actions.UserRead,
		Actions.UserManage,
		Actions.PipelineRun,
		Actions.PipelineManage,
	],
	ADMIN: [
		Actions.ProjectRead,
		Actions.ProjectCreate,
		Actions.ProjectAdmin,
		Actions.AssistantAsk,
		Actions.RunbookEdit,
		Actions.DeploymentRead,
		Actions.DeploymentCreate,
		Actions.IncidentManage,
		Actions.IntegrationManage,
		Actions.UserRead,
		Actions.UserManage,
		Actions.PipelineRun,
		Actions.PipelineManage,
	],
	MANAGER: [
		Actions.ProjectRead,
		Actions.ProjectCreate,
		Actions.AssistantAsk,
		Actions.RunbookEdit,
		Actions.DeploymentRead,
		Actions.IncidentManage,
		Actions.IntegrationManage,
		Actions.PipelineRun,
		Actions.PipelineManage,
	],
	DEVOPS: [
		Actions.ProjectRead,
		Actions.ProjectCreate,
		Actions.ProjectAdmin,
		Actions.AssistantAsk,
		Actions.RunbookEdit,
		Actions.DeploymentRead,
		Actions.DeploymentCreate,
		Actions.IncidentManage,
		Actions.IntegrationManage,
		Actions.PipelineRun,
		Actions.PipelineManage,
	],
	DEVELOPER: [
		Actions.ProjectRead,
		Actions.AssistantAsk,
		Actions.RunbookEdit,
		Actions.DeploymentRead,
		Actions.PipelineRun,
	],
	USER: [
		Actions.ProjectRead,
		Actions.AssistantAsk,
	],
};

export function hasPermission(role: string, action: Action): boolean {
	const permissions = ROLE_PERMISSIONS[role] ?? [];
	if (permissions.includes(action)) return true;

	if (action.startsWith("project.") && permissions.includes(Actions.ProjectAdmin)) {
		return true;
	}

	return false;
}
