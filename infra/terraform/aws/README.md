# Terraform for the AWS reference deployment

Reproduces the LeakTrace deployment that ran in `ap-south-1`: a VPC with public and private subnets, an API server running nginx and Express, a worker Auto Scaling group that scales from zero on queue depth, RDS PostgreSQL, three S3 buckets, SQS with a dead-letter queue, SNS alerts, an EventBridge Scheduler group, SSM Parameter Store configuration, IAM roles with least-privilege policies, and the CloudWatch alarms that drive scaling. Everything is tagged `Project=leaktrace`.

What it builds is described in `docs/aws/architecture-as-deployed.md`; the numbers from the live run are in `docs/aws/evidence.md`.

## Files

| File | Contents |
|---|---|
| `versions.tf` | provider and default tags |
| `variables.tf` | every name, size and secret as a variable |
| `network.tf` | VPC, subnets, route tables, internet gateway, S3 endpoint, security groups |
| `iam.tf` | roles, instance profiles and policies |
| `storage.tf` | the three buckets (encryption, public access block, versioning, lifecycle, optional CORS) |
| `messaging.tf` | SQS queues and redrive, SNS topics, Scheduler group |
| `ssm.tf` | the 16 parameters under `/leaktrace/prod/` |
| `database.tf` | RDS instance and subnet group |
| `compute.tf` | API server, worker launch template, Auto Scaling group, scaling policies, alarms |
| `imports.tf` | `import` blocks that adopt the existing live resources (see below) |
| `terraform.tfvars.example` | copy to `terraform.tfvars` (gitignored) and fill in |

## Plan against the live account

The plan was run with the read-only IAM user (`terraform plan` only; nothing was applied). Result:

```
Plan: 75 to import, 0 to add, 52 to change, 0 to destroy.
```

The 52 changes are not infrastructure differences:

| Count | What | Effect |
|---|---|---|
| 43 | the new `Project=leaktrace` tag on resources that had none | tags only |
| 8 | provider-side defaults that have no AWS equivalent (`force_destroy` on the three buckets, `revoke_rules_on_delete` on the three security groups, `wait_for_capacity_timeout` and `force_delete` on the group, `user_data_replace_on_change` on the server) | state only, no API call changes a setting |
| 1 | the database: `apply_immediately` (state only) and `skip_final_snapshot` going from `true` to `false`, so deleting it takes a final snapshot | the snapshot is deliberate and safer |

Nothing is replaced or destroyed. To reproduce the plan you need a read-only profile in the same account:

```
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan -var account_id=<ACCOUNT_ID> -var 'api_http_cidrs=[...the addresses in the live security group...]'
```

Differences you would see with other values: the secrets are placeholders (their SSM values are ignored after creation, so any value shows no change), and `api_http_cidrs` must list the exact addresses in the live security group or the plan shows an ingress change.

What had to be accommodated to get there:

- User data is read from `infra/user-data-*.sh` with Windows line endings normalised, so the worker template matches the live bytes.
- The API server ignores `ami` and `user_data` changes. The live server was first built from an older version of `infra/user-data-api.sh` and updated in place with `infra/redeploy-api.sh`; the current script also installs nginx. A new server gets the current script.
- SQS `max_message_size` is ignored: the live queues use 1 MiB, which the provider version pinned here does not yet accept as a value.
- The data bucket has no CORS rule in the live account. Set `evidence_cors_origins` to your web origin if you want browser uploads of evidence photos to work.
- The API security group also allows the CloudFront origin-facing prefix list (`api_allow_cloudfront`), as the live one does.
- SNS email subscriptions are created from `alert_emails` and are not imported; each address must confirm by email.

## Deploy from scratch

Prerequisites: AWS credentials with permission to create the resources above, Terraform 1.7 or newer, Node 20 or newer.

The first-boot scripts download from `s3://leaktrace-deploy-ccl2026`. Keep `bucket_suffix = "ccl2026"`, or change `BUCKET=` in `infra/user-data-api.sh`, `infra/user-data-worker.sh` and `infra/redeploy-api.sh` to match your suffix. Bucket names are global, so another account has to pick a different suffix.

1. **Package.** From the repository root:

   ```
   npm install
   npm run package
   ```

   This writes `release/api.tar.gz`, `release/worker.tar.gz`, `release/web.tar.gz` and the infra scripts.

2. **Create the buckets and upload the release.**

   ```
   cd infra/terraform/aws
   cp terraform.tfvars.example terraform.tfvars
   terraform init
   terraform apply -target=aws_s3_bucket.this
   aws s3 cp ../../../release/ s3://leaktrace-deploy-<suffix>/ --recursive
   ```

3. **Apply everything else.**

   ```
   terraform apply
   ```

   The API server boots, downloads the release, runs the database migration and starts. The first apply takes about 10 to 15 minutes, mostly the database.

4. **Create the demo users.** In EC2, open the API server with Session Manager and run the seed from `/opt/leaktrace/api` (`node dist/seed.js` with `APP_MODE=aws` and `DEMO_PASSWORD` set). The application reads its database user from the `DB_USER` parameter. The repository has no step that creates a separate application role, so either set `db_app_username` to the admin user or create the role yourself before the first start.

5. **Ten-step test.** Follow section 4 of `docs/deploy-notes-aws.md`: sign in, generate (a worker starts by itself after the queue alarm, about three to five minutes from the click on a cold group), schedule a release, download as a superintendent, trace a leak, check the audit log.

## Cost

About **$0.75 per day** (about ₹66) while the API server and the database are up, with the worker group at zero. That is the sum of the `t3.micro` server ($0.19), the `db.t4g.micro` instance ($0.37) and its 20 GB of storage ($0.06), the public IPv4 address ($0.09) and the server's volume ($0.03); S3, SQS, SNS and the S3 gateway endpoint add less than a cent. A worker costs well under a cent per demo run. Derivation and caveats: `docs/aws/inventory.md`.

## Destroy

The database has deletion protection on and takes a final snapshot, and the buckets are not force-destroyed. `terraform destroy` therefore needs three steps, and the cost keeps running until all are done:

1. Set `deletion_protection = false` in `database.tf` and run `terraform apply -target=aws_db_instance.main`.
2. Empty the three buckets. The data bucket has versioning, so delete old versions and delete markers too.
3. Run `terraform destroy`.

The final snapshot `leaktrace-db-final` is kept and costs a few cents a month until you delete it. When the deployment is gone, check for leftovers with `scripts/aws-leftovers.sh`. The ordered, console-and-CLI version of the teardown for the live account is `docs/aws/TEARDOWN.md`.
