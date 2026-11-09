#!/usr/bin/env bash
# Ship a new agent image to the running Phala CVM and approve its measurements on offmapfi.near.
set -euo pipefail
ROOT=~/blindside; CVM=c69a2763-22a7-4ac8-9980-18aa28be8c4a
U=https://b85acd75d1ee0d9a37241a18f68a6c55376b5e3a-8787.dstack-pha1-prod5.phala.network
docker info >/dev/null 2>&1 || { ( "/c/Program Files/Docker/Docker/Docker Desktop.exe" >/dev/null 2>&1 & ); for i in $(seq 1 40); do docker info >/dev/null 2>&1 && break; sleep 5; done; }
cd $ROOT && docker build --platform linux/amd64 -f apps/agent/Dockerfile -t ghcr.io/jenzylove/offmap-agent:latest . >/dev/null
gh auth token | docker login ghcr.io -u jenzylove --password-stdin >/dev/null 2>&1
DIGEST=$(docker push ghcr.io/jenzylove/offmap-agent:latest | grep -oE 'sha256:[0-9a-f]{64}' | tail -1); echo "image $DIGEST"
sed -i "s#offmap-agent@sha256:[0-9a-f]*#offmap-agent@$DIGEST#" apps/agent/docker-compose.yaml
cd contracts/near/deploy
OLD=$(python -c "import json,os;print(json.load(open(os.path.expanduser('~/offmap-attestation.json')))['tcb_info']['compose_hash'])")
node update-cvm.mjs $CVM | tail -1; sleep 60
for i in $(seq 1 30); do curl -s -m 60 $U/attestation -o ~/offmap-attestation.json || true; N=$(python -c "import json,os;print(json.load(open(os.path.expanduser('~/offmap-attestation.json')))['tcb_info']['compose_hash'])" 2>/dev/null || true); [ -n "$N" ] && [ "$N" != "$OLD" ] && break; sleep 20; done
WANT=$(node verify-compose.mjs | awk '{print $NF}'); echo "repo $WANT attested $N"; [ "$WANT" = "$N" ] || { echo "COMPOSE HASH MISMATCH"; exit 1; }
python - <<'PY'
import json,os
d=json.load(open(os.path.expanduser('~/offmap-attestation.json')));t=d['tcb_info']
kp=[e for e in t['event_log'] if e.get('imr')==3 and e.get('event')=='key-provider'][0]
m=json.load(open('measurements.json'))
m['measurements']={"rtmrs":{"mrtd":t['mrtd'],"rtmr0":t['rtmr0'],"rtmr1":t['rtmr1'],"rtmr2":t['rtmr2']},"key_provider_event_digest":kp['digest'],"app_compose_hash_payload":t['compose_hash']}
json.dump(m,open('measurements.json','w'),indent=2)
PY
cd $ROOT/apps/agent && npx tsx scripts/deploy-contract.ts --propose-config | tail -1
echo "Config proposed: run deploy-contract.ts --apply-config after the 24h notice"
