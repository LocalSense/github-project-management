var express = require('express')
    , GitHubApi = require("github")
    , github = new GitHubApi({
        version: "3.0.0"
      })
    , redis = require("redis")
    , client = redis.createClient()
    , _ = require('underscore')
    , sys = require(process.binding('natives').util ? 'util' : 'sys')
    , mongoose = require('mongoose')
    , Schema = mongoose.Schema;
    
var config = require('./config');
    
github.authenticate(config.auth);

var app = express.createServer();

app.set('view engine', 'jade');
app.set('views', __dirname + '/views');
app.use(express.static(__dirname + '/public'));
app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));

app.set('db-uri', 'mongodb://localhost/gitproject');
mongoose.connect(app.set('db-uri'));

var projectInfoSchema = new Schema({
    created: { type: Date, required: true, default: Date.now }
  , title: { type: String, required: true }
  , totals: {
        open_issues: { type: Number, default: 0, required: true }
      , closed_issues: { type: Number, default: 0, required: true }
      , total_issues: { type: Number, default: 0, required: true }
      , progress: { type: Number, default: 0, required: true }
    }
  , totalsHistory: [
      {
          open_issues: { type: Number, default: 0, required: true }
        , closed_issues: { type: Number, default: 0, required: true }
        , total_issues: { type: Number, default: 0, required: true }
        , progress: { type: Number, default: 0, required: true }
        , timestamp: { type: Date, required: true, default: Date.now }
      }
    ]
  , shamedUsers: [new Schema ({
        username: { type: String, required: true }
      , open_issues: { type: Number, default: 0, required: true }
    })]
  , shamedUsersHistory: [{
        timestamp: { type: Date, required: true, default: Date.now }
      , shamedUsers: [ 
          new Schema ({
              username: { type: String, required: true }
            , open_issues: { type: Number, default: 0, required: true }
          })
        ]
    }]
});

var milestoneSchema = new Schema({

    title: { type: String, required: true }
  , milestoneID: { type: Number, required: true }
  
  , totals: {
        open_issues: { type: Number, default: 0, required: true }
      , closed_issues: { type: Number, default: 0, required: true }
    }
  , totalsHistory: [{
        open_issues: { type: Number, default: 0, required: true }
      , closed_issues: { type: Number, default: 0, required: true }
      , timeStamp: { type: Date, required: true, default: Date.now }
    }]
});

var ProjectInfo = mongoose.model('ProjectInfo', projectInfoSchema);
var Milestone = mongoose.model('Milestone', milestoneSchema);

//Called regularly to update the database with current project data
setInterval(function() {
  getMilestones(function(milestones, projectInfo){
    var projectURI = 'https://github.com/' + config.project.user + '/' + config.project.repo;

    totalsHistory = projectInfo.totals;
    totalsHistory.timestamp = new Date();
    
    shameHistory = projectInfo.wallOfShame.map(function(shame){
      newShame = {
        username: shame.username
      , login: shame.login
      , open_issues: shame.open_issues
      }
      return newShame;
    });
    
    shameHistory.timestamp = new Date();
    
    ProjectInfo.update(
        { "title" : config.project.user + '/' + config.project.repo }
      , {   $set : {
                        "title" : config.project.user + '/' + config.project.repo
                      , "totals" : projectInfo.totals
                      , "shamedUsers" : projectInfo.wallOfShame
                    }
         ,  $push : {
                        "totalsHistory" : totalsHistory
                      , "shamedUsersHistory" : {
                            "timestamp": new Date()
                          , "shamedUsers": shameHistory
                        }
                    }
        }
      , {upsert: true}
      , function(err, numAffected){
          if (err) {
            console.log("Error updating project: " + err);
          } else {
            console.log("Updated " + numAffected + " record(s)");
          }
        }
    );
    milestones.map(function(milestone){
      Milestone.update(
          { "milestoneID" : milestone.id }
        , {   $set : {
                          "title" : milestone.title
                        , "milestoneID" : milestone.id
                        , "totals": {
                              "open_issues" : milestone.open_issues
                            , "closed_issues" : milestone.closed_issues
                          }
                      }
            , $push : {
                        "totalsHistory": {
                              "open_issues" : milestone.open_issues
                            , "closed_issues" : milestone.closed_issues
                            , "timestamp" : new Date()
                          }
                      }
          }
        , {upsert: true}
        , function(err, numAffected){
            if (err) {
              console.log("Error updating milestone " +milestone.title +": " + err);
            } else {
              console.log("Updated " + numAffected + " milestone(s)");
            }
          }             
      );
      return;
    });
  });
}, 3600000); //Runs every hour

//Called when a user hits index
app.get('/', function(req, res){
  getMilestones(function(milestones, projectInfo){
    
    var projectURI = 'https://github.com/' + config.project.user + '/' + config.project.repo;
    res.render('index', {
      project: {
        name: config.project.repo,
        uri: projectURI
      },
      shamedUsers: projectInfo.wallOfShame,
      milestones: milestones,
      totals: projectInfo.totals
    }); 
  });

});
app.get('/debug', function(req, res){
  ProjectInfo.find({}).exec(function(err, info){
    Milestone.find({}).exec(function(err, milestones){
      res.send({
                  'project' : info
                , 'milestones' : milestones
              });
    });
  });
});
app.listen(config.port);


function compare(a,b) {
  if (a.open_issues > b.open_issues)
     return -1;
  if (a.open_issues < b.open_issues)
    return 1;
  return 0;
}


function getIssues(milestone, projectInfo, next) {
  github.issues.repoIssues({
    user: config.project.user,
    repo: config.project.repo,
    milestone: milestone.number,
    state: 'open',
    per_page: 100
  }, function(err, issues) {
  
    issues = issues.map(function(issue) {
      if ((typeof(issue.assignee) != 'undefined') && (issue.assignee != null)) {
        projectInfo.userList.push(issue.assignee.login);
        
        projectInfo.userList = _.uniq(projectInfo.userList);
        
        if (typeof(projectInfo.mostOpenIssues[issue.assignee.login]) != 'undefined') {
          projectInfo.mostOpenIssues[issue.assignee.login].open_issues += 1;
        } else {
          projectInfo.mostOpenIssues[issue.assignee.login] = _.extend(issue.assignee, {
            username: issue.assignee.login,
            open_issues: 1
          });
        }

      }
      return issue;

    });
    next(projectInfo);
  });
}

function getMilestones(next) {
  github.issues.getAllMilestones({
    user: config.project.user,
    repo: config.project.repo,
    state: 'open',
    sort: 'due_date'
  }, function(err, milestones) {
  
    var projectInfo = {
        userList: []
      , mostOpenIssues: {}
      , wallOfShame: {}
      , totals: {
            open_issues: 0
          , closed_issues: 0
          , total_issues: 0
          , progress: 0
        }
    };
    
    var mscount = milestones.length - 1;
    var asyncCount = milestones.length - 1;
    while (mscount > -1) {
      
      milestone = milestones[mscount];
      
      if (milestone.closed_issues == 0) {
        milestone.progress = 0;
      } else {
        milestone.progress = (milestone.closed_issues / (milestone.closed_issues + milestone.open_issues)) * 100;
      }

      projectInfo.totals.open_issues    += milestone.open_issues;
      projectInfo.totals.closed_issues  += milestone.closed_issues;
      projectInfo.totals.total_issues   = projectInfo.totals.open_issues + projectInfo.totals.closed_issues;
      
      projectInfo.totals.progress = (projectInfo.totals.closed_issues / projectInfo.totals.total_issues) * 100;
      //console.log(projectInfo.totals.progress + ' ('+projectInfo.totals.closed_issues+'/'+(projectInfo.totals.closed_issues + projectInfo.totals.open_issues) +')');
      
      getIssues(milestone, projectInfo, function(updatedProjectInfo){
        projectInfo = updatedProjectInfo;
        projectInfo.wallOfShame = _.toArray(projectInfo.mostOpenIssues).sort(compare);
        if (asyncCount == 0) {
          next(milestones, projectInfo);
        }
        asyncCount--;
      });
      mscount--;
    };
    
  });
}