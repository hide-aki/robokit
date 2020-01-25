const GithubService = require('./github/github-service');
const cors = require('cors');
const yaml = require('js-yaml');
const express = require('express');
const cfg = require('./config');

class ApiGateway {
  constructor (app, cache) {
    this.app = app;
    this.cache = cache;
    this.githubService = new GithubService(app,cache);
    this.performanceService = require('./perfromance/performance-service');
    this.router = app.route();
    this.router.use(cors());
    this.router.use(express.json());
    this.start(this.router);
  }

  start () {
    this.router.get('/server/ping/', (request, response) => {
      console.log('ping request arrived -> reply with pong.');
      response.send({ time: Date.now() })
    });

    this.router.post('/pulls/status/:owner/:repo/:sha', (request, response) => {
      let ctx = this.cache.get(request.params.owner, request.params.repo);
      if(ctx) {
        request.body.owner = request.params.owner;
        request.body.repo = request.params.repo;
        request.body.sha = request.params.sha;
        this.thenResponse(this.githubService.updateStatus(ctx, request.body),response);
      } else {
        this.sendResponse(response,"no context was found for repo:" + request.body.owner+ "/" + request.body.repo );
      }
    });

    this.router.post('/checks/status/:owner/:repo/:sha', (request, response) => {
      console.log("### update status request: " + JSON.stringify(request.body));
      let ctx = this.cache.get(request.params.owner, request.params.repo);
      if(ctx) {
        request.body.owner = request.params.owner;
        request.body.repo = request.params.repo;
        request.body.sha = request.params.sha;

        this.thenResponse(this.githubService.createCheckRun(ctx, request.body),response);
      } else {
        this.sendResponse(response,"no context was found for repo:" + request.body.owner+ "/" + request.body.repo );
      }
    });

    this.router.post('/comment/:owner/:repo/', (request, response) => {
      let ctx = this.cache.get(request.params.owner, request.params.repo);
      if(ctx) {
        request.body.owner = request.params.owner;
        request.body.repo = request.params.repo;
        this.thenResponse(this.githubService.updateComment(ctx,request.body), response);
      } else {
        this.sendResponse(response,"no context was found for repo:" + request.body.owner+ "/" + request.body.repo );
      }
    });

    this.router.post('/comment/:owner/:repo/:issue_number/', (request, response) => {
      let ctx = this.cache.get(request.params.owner, request.params.repo);
      if(ctx) {
        request.body.owner = request.params.owner;
        request.body.repo = request.params.repo;
        request.body.issue_number = request.params.issue_number;
        this.thenResponse(this.githubService.createComment(ctx, request.body), response);
      } else {
        this.sendResponse(response,"no context was found for repo:" + request.body.owner+ "/" + request.body.repo );
      }
    });

    this.router.get('/commits/:owner/:repo/', (request, response) => {
      this.thenResponse(this.performanceService.listCommits(
        request.params.owner,
        request.params.repo), response)
    });

    this.router.get('/traces/:owner/:repo/:sha/:filter?', (request, response) => {
      let filter;
      if (request.params.filter) filter = JSON.parse(request.params.filter)
      this.performanceService.findReport(request.params.owner,
          request.params.repo,
          request.params.sha,
          filter).then(r => {
        const result = [];
        r.forEach(e => { result.push(e.data) });
        response.send(result);
      });
    });

    this.router.post('/traces/:owner/:repo/:sha/', (request, response) => {
      request.body.owner = request.params.owner;
      request.body.repo = request.params.repo;
      request.body.sha = request.params.sha;
      this.thenResponse(this.performanceService.addReport(
          request.body.owner,
          request.body.repo,
          request.body.sha,
          request.body.traces),
      response);
    });

    this.router.post('/webhooks/:owner?/:repo?', (request, response) => {
      if (request.params.owner) { request.body.owner = request.params.owner }
      if(request.params.repo)   { request.body.repo = request.params.repo   }
      this.thenResponse(this.githubService.saveWebhook(request.body), response);
    });

    this.router.get('/webhooks/:owner?/:repo?', (request, response) => {
      let msg = {};
      if (request.params.owner) { msg.owner = request.params.owner }
      if(request.params.repo)   { msg.repo = request.params.repo   }
      this.thenResponse(this.githubService.findWebhook(msg), response);
    });

    this.router.get('/webhooks/:owner/:repo/:sha/', (request, response) => {
      this.performanceService.findReport(
          request.params.owner,
          request.params.repo,
          request.params.sha)
          .then(r => {
              const result = [];
              r.forEach(e => {
                result.push(e.data);
              });
        this.writeResponse(result, response);
      });
    });

    this.router.get('/commits/:owner/:repo/', (request, response) => {
      this.performanceService.listCommits(request.params.owner,
        request.params.repo).then((r) => {
        writeResponse(r, response)
      }).catch((err) => {
        console.log(err)
      });
    });
  }

  async labels(owner,repo,issue_number){
    try {
      return await this.githubService.labels(owner,repo,issue_number);
    } catch(err) {
      console.error(err);
    }
  }

  async onPullRequest(context) {
    return this.githubService.onPullRequest(context);
  }
  isLabeled(labels, name) {
    let result = false;
    if(labels && Array.isArray(labels)) {
      labels.forEach(label => {
        if(label.name == name){
          result = true;
          return true;
        }
      });
    }
    return result;
  }

  async onCheckSuite(context) {
    let owner = context.payload.repository.owner.login;
    let repo = context.payload.repository.name;
    let sha = context.payload.check_suite.head_sha;
    let issue_number = context.payload.check_suite.pull_requests[0].number;

    let labels = await this.labels(owner,repo,issue_number);
    if(this.isLabeled(labels, cfg.deploy.label.name)) {
      if (context.payload.action == 'requested') {
        let body = this.checkStatus(owner,repo,sha, cfg.deploy.name, "queued");
        this.githubService.createCheckRun(context, body);

      } else if(context.payload.action == 'completed' && context.payload.check_suite.conclusion == "success") {
        // CI COMPLETED WITH SUCCESS
        // TRIGGER CD SERVER DEPLOY AND THEN:
        let body = this.checkStatus(owner,repo,sha, cfg.deploy.name, "in_progress");
        this.githubService.createCheckRun(context, body);
      }

    }
  }


  async onCheckRun(context) {
    if(context.payload.check_run.name == cfg.deploy.name){

    }
    return this.githubService.onCheckSuite(context);
  }

  createPullRequest(ctx) {
    this.githubService.createPullRequest(ctx);
  }

  async deployYaml(context){
    try {
      let deploy = await this.githubService.content(context.payload.repository.owner.login,
          context.payload.repository.name,
          "deploy.yml");

      if(deploy) context.deploy = yaml.load(deploy);
    } catch(err) {
      console.error(err);
    }
    return context;
  }

  thenResponse (p, response) {
    p.then((r) => {
      response.send(r)
    }).catch((err) => {
      console.error(err);
      response.status(500);
      response.send(err.message)
    });
  };

  sendResponse (response, result) {
    if (result === 'ok') {
      response.send(result)
    } else {
      response.status(500)
      response.send('PR URL is wrong/ not found or not waiting for update.')
    }
  };


  route(context) {
    this.githubService.route(context);
  }

  checkStatus(owner,repo,sha, name, status) {
    if(status=='completed') {
      return {
        owner: owner,
        repo: repo,
        sha: sha,
        checks: [{
          name: name,
          status: status,
          conclusion: "success",
          output: {
            title: "Deploy branch to the cloud",
            summary: "deploy will start when check suite completes",
            text: "waiting for CI to complete successfully"
          }
        }]
      }
    } else
      return {
        owner: owner,
        repo: repo,
        sha: sha,
        checks: [{
          name: name,
          status: status,
          output: {
            title: "Deploy branch to the cloud",
            summary: "deploy will start when check suite completes",
            text: "waiting for CI to complete successfully"
          }
        }]
    }
  }
}
module.exports = ApiGateway;
