# BuildIT AWS boundary

This stack belongs in a dedicated **BuildIT Production** AWS account. Do not deploy it into Pulsetrade, a personal account, or an account shared with another product.

Deploy the production stack only in `eu-west-1`. The web app and Convex deployment are already in Ireland, so this keeps key operations and temporary source-derived artifacts close to both services. S3 Standard provides regional redundancy; source-derived data is deliberately not copied to another region.

The template creates a dedicated content-broker role and a team-scoped Vercel identity provider. Its trust policy accepts only the separate `buildit-content-broker` project's production environment—not the user-facing web project. That role is the only application identity granted object and envelope-key operations, and it can be used only through short-lived workload credentials; do not create an IAM access key.

Before deployment:

1. Create or select the dedicated BuildIT Production AWS account under an AWS organization.
2. Authenticate the AWS CLI with temporary browser credentials or an administrator role using AWS IAM Identity Center.
3. Deploy `artifacts.yaml` in Ireland with the exact Vercel team and project names. The production defaults are the dedicated `buildit-agentic-review` Vercel team and `buildit-content-broker` project; do not use the unrelated Pulsetrade team. Then record the stack outputs in the deployment secret store.
4. Run the retention, cross-tenant ciphertext-swap, deletion, restore, and key-rotation drills before enabling repository execution.

The bucket is intentionally non-versioned. Application deletion removes an object immediately, while the lifecycle rule is a seven-day maximum backstop. CloudFormation retains the empty bucket and KMS key during stack deletion to prevent an infrastructure command from silently destroying customer evidence or making retained ciphertext unrecoverable.
