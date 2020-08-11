import { FlowRouter } from 'meteor/kadira:flow-router';
import toastr from 'toastr';
import SHA256 from 'meteor-sha256';

import './login.html';

Template.login.events({
  'submit form'(e, instance) {
    e.preventDefault();

    const email = $('#loginEmail').val();
    const password = $('#loginPassword').val();

    if (!email || !password) {
      toastr.error("Input your email and password.");
      return;
    }

    const hashedPassword = SHA256(password);

    Meteor.loginWithPassword({ email }, hashedPassword, (err, result) => {
      if (err) {
        if (err.reason === "User has no password set") {
          // Trying to login with an imported user, let's try to convert their password
          Meteor.call('user/convertPassword', email, password, hashedPassword, (err, result) => {
            if (err) {
              console.log(err);
              toastr.error("Failed to login using mvplugins.com user. If the error continues, try resetting your password.");
              return;
            }

            // If the password changed successfully, call the login method again
            Meteor.loginWithPassword({ email }, hashedPassword, (err, result) => {
              if (err) {
                console.log(err);
                toastr.error("Failed to login using mvplugins.com user. If the error continues, try resetting your password.");
                return;
              }

              FlowRouter.go('/me');
            });
          });
          return;
        }

        toastr.error("Login failed.");
        console.log(err);
      } else {
        FlowRouter.go('/me');
      }
    })
  },

  'click .btn-github'(e, instance) {
    e.preventDefault();

    Meteor.loginWithGithub((err) => {
      if (err) {
        console.log(err);
        toastr.error("Login failed");
        return;
      }

      FlowRouter.go('/me');
    });
  }
});