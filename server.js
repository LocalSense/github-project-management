var express = require('express'),
    GitHubApi = require("github"),
    github = new GitHubApi({
      version: "3.0.0"
    }),
    redis = require("redis"),
    client = redis.createClient(),
    _ = require('underscore');
    
var config = require('./config');
    
github.authenticate(config.auth);

var app = express.createServer();

app.set('view engine', 'jade');
app.set('views', __dirname + '/views');
app.use(express.static(__dirname + '/public'));
app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));

setInterval(function() {

}, 5000);

var userList = [];
var mostOpenIssues = {};
var wallOfShame = [];

app.get('/', function(req, res){

  github.issues.getAllMilestones({
    user: config.project.user,
    repo: config.project.repo,
    state: 'open',
    sort: 'due_date'
  }, function(err, milestones) {
  
    var totals = {
      open_issues: 0,
      closed_issues: 0,
      total_issues: 0,
      progress: 0
    }
  
    milestones = milestones.map(function(milestone) {
    
      if (milestone.closed_issues == 0) {
        milestone.progress = 0;
      } else {
        milestone.progress = (milestone.closed_issues / (milestone.closed_issues + milestone.open_issues)) * 100;
      }

      totals.open_issues    += milestone.open_issues;
      totals.closed_issues  += milestone.closed_issues;
      totals.total_issues   = totals.open_issues + totals.closed_issues;
      
      totals.progress = (totals.closed_issues / totals.total_issues) * 100;
      console.log(totals.progress + ' ('+totals.closed_issues+'/'+(totals.closed_issues + totals.open_issues) +')');
      
      github.issues.repoIssues({
        user: config.project.user,
        repo: config.project.repo,
        milestone: milestone.number,
        state: 'open',
        per_page: 100
      }, function(err, issues) {
        
        issues = issues.map(function(issue) {
        
          if ((typeof(issue.assignee) != 'undefined') && (issue.assignee != null)) {
            console.log(issue.assignee);
            userList.push(issue.assignee.login);
            
            userList = _.uniq(userList);
            
            if (typeof(mostOpenIssues[issue.assignee.login]) != 'undefined') {
              mostOpenIssues[issue.assignee.login].open_issues += 1;
            } else {
              mostOpenIssues[issue.assignee.login] = _.extend(issue.assignee, {
                username: issue.assignee.login,
                open_issues: 1
              });
            }

          }

          return issue;

        });

        wallOfShame = _.toArray(mostOpenIssues).sort(compare);
      });
      
      return milestone;
    });
    
    var projectURI = 'https://github.com/' + config.project.user + '/' + config.project.repo;

    console.log('rendering!');
    res.render('index', {
      project: {
        name: config.project.repo,
        uri: projectURI
      },
      shamedUsers: wallOfShame,
      milestones: milestones,
      totals: totals
    });
    userList = [];
    mostOpenIssues = {};
    wallOfShame = [];    

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
