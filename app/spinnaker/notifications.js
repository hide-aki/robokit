const Repository = require('./repository')
const CronJob = require('cron').CronJob
const cfg = require('../config');
class Notifications {

  constructor (githubService) {
    this.githubService = githubService
    this.repository = new Repository('github-gateway');
    this.repository.connect('pipelines');
    this.job = new CronJob('*/5 * * * * *', async () => {
        this._poll();
    }, null, true, 'America/Los_Angeles');
  }

  start () {
    this.job.start();
  }

  store (data) {
    return this.repository.insert(data).then(res=>{
      this.job.start();
    });
  }

  async _poll () {
      if(this.repository) {
        let count = await this.repository.count();
        while (count!==0) {
          this.repository.findOldest()
            .then(item => {
                console.log(item.value);
                if(item.value && item.value!=null) {
                  let github = this.githubService.cache.get(item.value.owner, item.value.repo);
                  let check = this.toChecks(item.value);
                  this.githubService.createCheckRun(github, check,item.value);
                }
            }).catch(err=>{
              console.error(err);
            });
            count = await this.repository.count();
        }
      }
      let count = await this.repository.count();
      if(count == 0){
        this.job.stop();
      }
  }

  toChecks (data) {
    let req = {
      owner: data.owner,
      repo: data.repo,
      head_sha: data.sha,
      name: data.check_run_name,
      status: data.status
    };
    req.conclusion= data.conclusion;
    req.output = cfg.deploy.check.cd_pipeline_status_update;
    return [req];
  }
}

module.exports = Notifications
