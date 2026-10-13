pipeline {
  agent any
  options {
    disableConcurrentBuilds()
    skipDefaultCheckout()
    timeout(time: 8, unit: 'MINUTES')
  }
  stages {
    stage('Checkout and identify') {
      steps {
        checkout scm
        sh '''#!/bin/sh
set -eu
mkdir -p artifacts
git rev-parse HEAD > artifacts/checked-out-sha.txt
printf '%s\n' "$BRANCH" > artifacts/checked-out-branch.txt
'''
        echo "[sg-target] branch=${params.BRANCH} environment=${params.TARGET_ENV}"
      }
    }
    stage('Target environment validation') {
      steps { echo "[sg-target] synthetic target ${params.TARGET_ENV}; deployment disabled" }
    }
    stage('Optional checks') {
      when { expression { params.RUN_EXTRA_CHECKS == true || params.TARGET_ENV == 'dev' } }
      steps { echo '[sg-target] optional checks passed' }
    }
    stage('Package simulation') {
      steps {
        sh '''#!/bin/sh
set -eu
printf 'branch=%s\nenvironment=%s\nnote=%s\n' "$BRANCH" "$TARGET_ENV" "${DEMO_NOTE:-boolean profile}" > artifacts/simulation.txt
'''
      }
    }
    stage('Manual approval demonstration') {
      when { expression { (params.DEMO_NOTE ?: '').startsWith('input ') } }
      steps { input message: 'Synthetic approval gate only; no deployment follows', ok: 'Continue', submitterParameter: 'APPROVED_BY' }
    }
    stage('Result demonstration') {
      when { expression { params.RESULT_MODE != null } }
      steps {
        script {
          if (params.RESULT_MODE == 'unstable') {
            catchError(buildResult: 'UNSTABLE', stageResult: 'UNSTABLE') { error('Intentional synthetic unstable stage') }
          }
          if (params.RESULT_MODE == 'failure') { error('Intentional synthetic failure stage') }
        }
      }
    }
  }
  post { always { archiveArtifacts artifacts: 'artifacts/*', allowEmptyArchive: true } }
}
