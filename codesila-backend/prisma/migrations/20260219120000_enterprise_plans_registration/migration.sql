-- Update plan names and descriptions to be enterprise/corporate focused
UPDATE "plans" SET
  "displayName" = 'Startup',
  "description" = 'For startups and small teams building their first product',
  "name" = 'startup',
  "maxUsers" = 10,
  "maxProjects" = 5,
  "maxStorage" = 2147483648,
  "maxApiCalls" = 25000,
  "maxDroplets" = 2,
  "maxWebhooks" = 5,
  "monthlyPrice" = 0,
  "annualPrice" = 0,
  "features" = '{"chat":true,"assistant":true,"github_integration":true,"sso":false,"audit_log":false,"custom_domain":false,"priority_support":false,"advanced_analytics":false}'::jsonb,
  "updatedAt" = NOW()
WHERE "id" = 'plan_free';

UPDATE "plans" SET
  "displayName" = 'Business',
  "description" = 'For growing companies that need team collaboration and integrations',
  "name" = 'business',
  "maxUsers" = 50,
  "maxProjects" = 25,
  "maxStorage" = 21474836480,
  "maxApiCalls" = 100000,
  "maxDroplets" = 10,
  "maxWebhooks" = 20,
  "monthlyPrice" = 4900,
  "annualPrice" = 49000,
  "features" = '{"chat":true,"assistant":true,"github_integration":true,"sso":false,"audit_log":true,"custom_domain":false,"priority_support":false,"advanced_analytics":true}'::jsonb,
  "updatedAt" = NOW()
WHERE "id" = 'plan_starter';

UPDATE "plans" SET
  "displayName" = 'Corporate',
  "description" = 'For established companies with advanced security and compliance needs',
  "name" = 'corporate',
  "maxUsers" = 200,
  "maxProjects" = 100,
  "maxStorage" = 107374182400,
  "maxApiCalls" = 500000,
  "maxDroplets" = 50,
  "maxWebhooks" = 100,
  "monthlyPrice" = 14900,
  "annualPrice" = 149000,
  "features" = '{"chat":true,"assistant":true,"github_integration":true,"sso":true,"audit_log":true,"custom_domain":true,"priority_support":true,"advanced_analytics":true}'::jsonb,
  "updatedAt" = NOW()
WHERE "id" = 'plan_professional';

UPDATE "plans" SET
  "displayName" = 'Enterprise',
  "description" = 'For large organizations — dedicated infrastructure, custom SLAs, and tailored onboarding',
  "name" = 'enterprise',
  "features" = '{"chat":true,"assistant":true,"github_integration":true,"sso":true,"audit_log":true,"custom_domain":true,"priority_support":true,"advanced_analytics":true,"dedicated_support":true,"custom_integrations":true,"white_label":true}'::jsonb,
  "updatedAt" = NOW()
WHERE "id" = 'plan_enterprise';
