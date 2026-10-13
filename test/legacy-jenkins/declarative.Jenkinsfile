pipeline {
  agent any
  options {
    timeout(time: 60, unit: 'SECONDS')
    disableConcurrentBuilds()
  }
  stages {
    stage('准备合成测试数据') {
      steps {
        sh '''#!/bin/sh
set -eu
mkdir -p reports artifacts
failed=0
if [ "$MODE" = "unstable" ]; then failed=1; fi
cat > reports/legacy-junit.xml <<EOF
<testsuite name="LegacyDemo" tests="1" failures="$failed" errors="0" skipped="0">
  <testcase classname="legacy.demo" name="fixture-contract">
EOF
if [ "$failed" = 1 ]; then
  printf '%s\n' '    <failure message="Intentional legacy demo assertion mismatch">Synthetic unstable result</failure>' >> reports/legacy-junit.xml
fi
cat >> reports/legacy-junit.xml <<EOF
  </testcase>
</testsuite>
EOF
printf '环境=%s\n模式=%s\n检查=%s\n消息=%s\n' "$TARGET_ENV" "$MODE" "$RUN_EXTRA_CHECKS" "$DEMO_MESSAGE" > 'artifacts/legacy-summary.txt'
'''
        echo "[legacy-demo] TARGET_ENV=${params.TARGET_ENV} MODE=${params.MODE} RUN_EXTRA_CHECKS=${params.RUN_EXTRA_CHECKS}"
        echo "[legacy-demo] 中文参数已通过参数环境变量读取：${params.DEMO_MESSAGE}"
      }
    }
    stage('开发环境校验') {
      when { expression { params.TARGET_ENV == 'dev' } }
      steps { echo '[legacy-demo] dev-only stage selected' }
    }
    stage('预发布校验') {
      when { expression { params.TARGET_ENV == 'staging' } }
      steps { echo '[legacy-demo] staging-only stage selected' }
    }
    stage('生产模拟校验') {
      when { expression { params.TARGET_ENV == 'prod-demo' } }
      steps { echo '[legacy-demo] isolated production-shaped fixture; no deployment' }
    }
    stage('可选扩展检查') {
      when { expression { params.RUN_EXTRA_CHECKS } }
      steps { echo '[legacy-demo] boolean parameter enabled the optional stage' }
    }
    stage('模拟失败') {
      when { expression { params.MODE == 'failure' } }
      steps { error('[legacy-demo] intentional FAILURE result for history demonstration') }
    }
  }
  post {
    always {
      junit 'reports/*.xml'
      archiveArtifacts artifacts: 'artifacts/*', allowEmptyArchive: true
    }
  }
}
