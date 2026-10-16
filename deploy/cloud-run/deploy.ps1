param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
  [ValidatePattern('^[a-z0-9-]+$')][string]$Region = 'us-central1',
  [ValidatePattern('^[a-z0-9-]+$')][string]$JobName = 'flea-worker',
  [switch]$ExistingInfrastructure,
  [switch]$Execute
)
$ErrorActionPreference = 'Stop'
Get-Command gcloud -ErrorAction Stop | Out-Null
function Invoke-Gcloud([string[]]$Arguments) {
  & gcloud @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'Google Cloud command failed. Resolve that error before continuing.' }
}
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$results = "$ProjectId-flea-results"
$source = "$ProjectId-flea-build-source"
$runtime = "flea-worker@$ProjectId.iam.gserviceaccount.com"
$builder = "flea-build@$ProjectId.iam.gserviceaccount.com"
$image = "$Region-docker.pkg.dev/$ProjectId/flea/worker:" + (Get-Date -Format 'yyyyMMddHHmmss')
if (-not $ExistingInfrastructure) {
  Invoke-Gcloud @('services','enable','run.googleapis.com','cloudbuild.googleapis.com','artifactregistry.googleapis.com','storage.googleapis.com','iam.googleapis.com',"--project=$ProjectId")
  # Create fresh private resources; an existing/conflicting name fails closed.
  foreach ($bucket in @($results,$source)) {
    Invoke-Gcloud @('storage','buckets','create',"gs://$bucket","--location=$Region",'--uniform-bucket-level-access','--public-access-prevention',"--project=$ProjectId")
  }
  Invoke-Gcloud @('storage','buckets','update',"gs://$source",('--lifecycle-file=' + (Join-Path $PSScriptRoot 'build-source-lifecycle.json')),"--project=$ProjectId")
  Invoke-Gcloud @('iam','service-accounts','create','flea-worker',"--project=$ProjectId")
  Invoke-Gcloud @('iam','service-accounts','create','flea-build',"--project=$ProjectId")
  Invoke-Gcloud @('storage','buckets','add-iam-policy-binding',"gs://$results","--member=serviceAccount:$runtime",'--role=roles/storage.objectCreator',"--project=$ProjectId")
  Invoke-Gcloud @('storage','buckets','add-iam-policy-binding',"gs://$source","--member=serviceAccount:$builder",'--role=roles/storage.objectViewer',"--project=$ProjectId")
  Invoke-Gcloud @('artifacts','repositories','create','flea','--repository-format=docker',"--location=$Region","--project=$ProjectId")
  Invoke-Gcloud @('artifacts','repositories','add-iam-policy-binding','flea',"--location=$Region","--member=serviceAccount:$builder",'--role=roles/artifactregistry.writer',"--project=$ProjectId")
  Invoke-Gcloud @('projects','add-iam-policy-binding',$ProjectId,"--member=serviceAccount:$builder",'--role=roles/logging.logWriter','--condition=None')
}
Invoke-Gcloud @('builds','submit',$root,('--config=' + (Join-Path $PSScriptRoot 'cloudbuild.yaml')),"--substitutions=_IMAGE=$image","--service-account=projects/$ProjectId/serviceAccounts/$builder","--gcs-source-staging-dir=gs://$source/source","--project=$ProjectId")
Invoke-Gcloud @('beta','run','jobs','deploy',$JobName,"--image=$image","--region=$Region","--project=$ProjectId","--service-account=$runtime",'--cpu=2','--memory=8Gi','--task-timeout=5400s','--tasks=1','--parallelism=1','--max-retries=0','--args=2524251',"--set-env-vars=FLEA_RESULTS_BUCKET=$results",'--add-volume=name=scratch,type=ephemeral-disk,size=10Gi','--add-volume-mount=volume=scratch,mount-path=/scratch')
if ($Execute) { Invoke-Gcloud @('run','jobs','execute',$JobName,"--region=$Region","--project=$ProjectId",'--wait') }
Write-Host "Job: $JobName; results: gs://$results/results/"
