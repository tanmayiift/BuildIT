# BuildIT AWS boundary

This stack belongs in a dedicated **BuildIT Production** AWS account. Do not deploy it into Pulsetrade, a personal account, or an account shared with another product.

Deploy the production stack only in `eu-west-1`. The web app and Convex deployment are already in Ireland, so this keeps key operations and temporary source-derived artifacts close to both services. S3 Standard provides regional redundancy; source-derived data is deliberately not copied to another region.

The template requires a dedicated content-broker role ARN. That role is the only application identity granted object and envelope-key operations. The role must use temporary workload credentials; do not create an IAM access key.

Before deployment:

1. Create or select the dedicated BuildIT Production AWS account under an AWS organization.
2. Create the content-broker workload role with no human login and no long-lived key.
3. Authenticate the AWS CLI with an administrator role using AWS IAM Identity Center.
4. Deploy `artifacts.yaml` in Ireland and record the stack outputs in the deployment secret store.
5. Run the retention, cross-tenant ciphertext-swap, deletion, restore, and key-rotation drills before enabling repository execution.

The bucket is intentionally non-versioned. Application deletion removes an object immediately, while the lifecycle rule is a seven-day maximum backstop. CloudFormation retains the empty bucket and KMS key during stack deletion to prevent an infrastructure command from silently destroying customer evidence or making retained ciphertext unrecoverable.
