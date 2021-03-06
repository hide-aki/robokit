const cfg = require('./config')
class Utils {
  isLabeled (labels, names) {
    let result = false
    if (labels && Array.isArray(labels)) {
      labels.forEach(label => {
        names.forEach(name => {
          if (label.name == name) {
            result = true
            return true
          }
        })
      })
    }
    return result
  }

  isPullRequest (context) {
    if (context.payload.check_suite) {
      return (context.payload.check_run.check_suite && context.payload.check_suite.pull_requests > 0)
    } else {
      return (context.payload.check_run.pull_requests && context.payload.check_run.pull_requests.length > 0)
    }
  }

  issueNumber (context) {
    if (context.payload.check_run) {
      if (context.payload.check_run.check_suite) {
        if (context.payload.check_run.check_suite.pull_requests.length > 0) {
          return context.payload.check_run.check_suite.pull_requests[0].number
        }
      } else {
        if (context.payload.check_run.pull_requests.length > 0) {
          return context.payload.check_run.pull_requests[0].number
        }
      }
    }
  }

  branchName (context) {
    if (context.payload.check_suite) {
      return context.payload.check_suite.head_branch
    } else if (context.payload.check_run) {
      return context.payload.check_run.check_suite.head_branch
    }
  }

  targetNamespace (ctx) {
    if (ctx.is_pull_request) {
      return ctx.owner + '-' + ctx.repo + '-' + 'pr-' + ctx.issue_number
    } else {
      return ctx.owner + '-' + ctx.repo + '-' + ctx.branch_name
    }
  }

  toPullRequestDeployContext (context) {
    const ctx = {
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      branch_name: context.payload.pull_request.head.ref,
      sha: context.payload.pull_request.head.sha,
      is_pull_request: true,
      action: context.payload.action,
      issue_number: context.payload.number
    }
    ctx.namespace = this.targetNamespace(ctx)
    return ctx
  }

  toCheckRunDeployContext (context) {
    const ctx = {
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      branch_name: this.branchName(context),
      sha: context.payload.check_run.head_sha,
      is_pull_request: this.isPullRequest(context),
      check_run_name: context.payload.check_run.name,

      conclusion: context.payload.check_run.conclusion,
      status: context.payload.check_run.status,
      action: context.payload.action
    }
    if (ctx.is_pull_request) { ctx.issue_number = this.issueNumber(context) }

    ctx.namespace = this.targetNamespace(ctx)
    return ctx
  }

  deployCheckRunName (is_pull_request) {
    if (is_pull_request) {
      return +' (pull_request)'
    } else {
      return cfg.deploy.check.name + ' (push)'
    }
  }

  mapToChecks (req) {
    const all = []
    for (let i = 0; i < req.checks.length; i++) {
      const check = {
        owner: req.owner,
        repo: req.repo,
        head_sha: req.sha,
        name: req.checks[i].name,
        status: req.checks[i].status,
        output: req.checks[i].output
      }
      if (req.checks[i].conclusion && req.checks[i].conclusion != null) {
        check.conclusion = req.checks[i].conclusion
      }
      all.push(check)
    }
    return all
  }

  is_check_run_in_status (deploy, propName) {
    if (deploy.is_pull_request) {
      for (let i = 0; i < cfg.deploy.on.pull_request.actions.length; i++) {
        if ((deploy.labeled) && (deploy.check_run_name == cfg.deploy.on.pull_request.actions[i].name)) {
          if (deploy.status == cfg.deploy.on.pull_request.actions[i][propName]) {
            return true
          }
        }
      }
    } else {
      for (let i = 0; i < cfg.deploy.on.push.actions.length; i++) {
        if ((deploy.check_run_name == cfg.deploy.on.push.actions[i].name) &&
          (deploy.status == cfg.deploy.on.push.actions[i][propName])) {
          for (let j = 0; j < cfg.deploy.on.push.branches.length; j++) {
            if (cfg.deploy.on.push.branches[j] == deploy.branch_name) {
              if (deploy.status == cfg.deploy.on.push.actions[j][propName]) {
                return true
              }
            }
          }
        }
      }
    }
    return false
  }

  format (field, values) {
    Object.entries(values).forEach((e) => {
      field = field.replace('${' + e[0] + '}', e[1])
    })
    return field
  }

  toDetails (context) {
    let stages = context.stages
    let details = ""
    Object.entries(stages).sort(function(stageA, stageB) {
      return  Number(stageA[1].Id) -  Number(stageB[1].Id)
    }).forEach(stage => {
      let startDate = new Date (stage[1].startTime)
      let endDate = new Date (stage[1].endTime)
      let duration  = this.duration(endDate,startDate)
      details += `${this.getMarker( stage[1].status )} STAGE[${ stage[0]}, ${duration}s, ${this.time(stage[1].endTime)}] ${ stage[1].name} : ${ stage[1].status } \n`
      for (let j = 0 ; j < stage[1].tasks.length ; j++ ) {
        let startDate = new Date (stage[1].tasks[j].startTime)
        let endDate = new Date (stage[1].tasks[j].endTime)
        let duration  = endDate.getSeconds() - startDate.getSeconds()
        details += `${ this.getMarker( stage[1].tasks[j].status ) } ${endDate.toISOString()} ${duration}s ${ stage[1].tasks[j].name } : ${ stage[1].tasks[j].status } \n`
      }
    }) 
    return details
  }
  duration(endDate, startDate) {
    let t= endDate.getSeconds() - startDate.getSeconds()
    if(t.toString() == "NaN") {
      return "--"
    } else {
      return t
    }
  }
  time(t){
    if(t){
      return new Date (t).toISOString()
    } else return "....-..-..T..:..:.....z"
  }
  getPrgress(status, conclusion) {
    if(conclusion=="success" ) {
      return `:heavy_check_mark: &nbsp;&nbsp;&nbsp; Deployed!  `
    }else if(conclusion== "cancelled") {
        return `:no_entry_sign: &nbsp;&nbsp;&nbsp; CANCELLED!  `
    } else if(status=="completed" && conclusion && conclusion!=null) {
      return `:x: &nbsp;&nbsp;&nbsp; FAILED!  `
    } else {
      console.log("Deploying "+ status + " " + conclusion)
      return `<img align="left" width="22" src="https://tinyurl.com/re3r65s"> Deploying...`
    }
  }

  toPrgress(status) {
    if(status=="SUCCEEDED" ) {
      return `:heavy_check_mark: &nbsp;&nbsp;&nbsp; Deployed!  `
    } else if(status == "TERMINAL" || status =="FAILED_CONTINUE") {
      return `:x: &nbsp;&nbsp;&nbsp; FAILED!  `
    } else if (status == "NOT_STARTED"|| status =="RUNNING"){
      console.log("Deploying "+ status)
      return `<img align="left" width="22" src="https://tinyurl.com/re3r65s"> Deploying...`
    } else if(status=="CANCELED" || status=="PAUSED" || status =="SUSPENDED") {
      return `:no_entry_sign: &nbsp;&nbsp;&nbsp; ${status}!`
    }
  }

  getMarker(status){
    if (status=="SUCCEEDED") {
      return ">"
    }else if (status == "TERMINAL" || status == "FAILED_CONTINUE") {
      return "<"
    }else if(status=="CANCELED" || status=="PAUSED" || status =="SUSPENDED") {
      return "#"
    }else if(status=="RUNNING"){
      return "*"
    }else return " "
  }

  /*
   Required if you provide completed_at or a status of completed. The final conclusion of the check.
   Can be one of success, failure, neutral, cancelled, timed_out, or action_required.
   When the conclusion is action_required, additional details should be provided on the site specified by details_url.
   Note: Providing conclusion will automatically set the status parameter to completed. Only GitHub can change a check run conclusion to stale.
   */
  getStatus (status) {
    if (status==="SUCCEEDED") { return {
      status: "completed",
      conclusion: "success"
    }} else if (status == "TERMINAL" || status =="FAILED_CONTINUE") { return {
      status: "completed",
      conclusion: "failure"
    }} else if (status == "NOT_STARTED"|| status =="RUNNING") { return {
      status: "in_progress"
    }} else if(status=="CANCELED" || status=="PAUSED" || status =="SUSPENDED") { return {
      status: "completed",
      conclusion: "cancelled"
    }}
  }
}

module.exports = new Utils()
