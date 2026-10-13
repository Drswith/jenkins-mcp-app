// [legacy-demo] fixture branch: master
pipeline {
  agent any
  options {
    timeout(time: 60, unit: 'SECONDS')
    disableConcurrentBuilds()
  }
  stages {
    stage('确认所选分支与提交') {
      steps {
        sh '''#!/bin/sh
set -eu
mkdir -p artifacts reports
actual_sha=$(git rev-parse HEAD)
test -n "$BRANCH"
grep -Fqx "// [legacy-demo] fixture branch: $BRANCH" Jenkinsfile
printf 'parameter_branch=%s\ncommit_sha=%s\nsource_fixture=master\n' "$BRANCH" "$actual_sha" > artifacts/selected-branch.txt
printf '[legacy-demo] selected branch: %s\n' "$BRANCH"
printf '[legacy-demo] checked out SHA: %s\n' "$actual_sha"
printf '<testsuite name="LegacyBranchFixture" tests="1" failures="0" errors="0"><testcase classname="legacy.demo" name="branch-checkout"/></testsuite>\n' > reports/legacy-junit.xml
'''
      }
    }
  }
  post {
    always {
      junit 'reports/*.xml'
      archiveArtifacts artifacts: 'artifacts/*', allowEmptyArchive: false
    }
  }
}
