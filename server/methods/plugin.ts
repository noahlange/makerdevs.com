import { Meteor } from 'meteor/meteor';
import { Match, check } from 'meteor/check';

import Plugins from '../../models/Plugins';
import Users from '../../models/Users';
import Files from '../../models/Files';
import Clicks from '../../models/Clicks';
import { Platforms } from '../../data/Platforms';
import { UploadedPlugin, Plugin, ModifiedPlugin, SubmittedReview } from '../../lib/types/Plugin';
import { validateFile } from '../../lib/fileTypes';

import createDOMPurify from 'dompurify';
import { JSDOM } from "jsdom";
import gravatar from 'gravatar';

const DOMPurify = createDOMPurify(new JSDOM('').window as any);

Meteor.methods({
  'plugin/details'(pluginId) {
    check(pluginId, String);

    const plugin = Plugins.findOneByIdOrSlug(pluginId);

    if (plugin) {
      const user = Users.findOneById(plugin.userId);
      if (user) {
        plugin.author = user.name;
        plugin.authorSlug = user.slug;
        plugin.donationUrl = user.donationUrl;
      } else {
        plugin.author = 'Unknown User';
        plugin.authorSlug = plugin.userId;
      }

      if (!plugin.public && plugin.userId !== Meteor.userId()) {
        throw new Meteor.Error('not-authorized', 'private', plugin.authorSlug);
      }

      const platforms: Array<string> = [];
      for (const version of plugin.versions) {
        if (!version) continue;

        for (const platformCode of version.platforms) {
          if (platforms.includes(platformCode)) {
            continue;
          }
          platforms.push(platformCode);
        }
      }

      plugin.platforms = platforms.map(code => Platforms[code]);

      for (const review of plugin.reviews) {
        if (!review) continue;

        const reviewUser = Users.findOneById(review.userId);
        if (reviewUser && reviewUser.name) {
          review.author = reviewUser.name;
          review.authorSlug = reviewUser.slug;
          review.authorAvatar = gravatar.url(reviewUser.emails[0].address);
        } else {
          review.author = 'Unknown User';
          review.authorSlug = review.userId;
        }
      }
    }

    return plugin;
  },

  'plugin/latest'() {
    return Plugins.findLatest(10).fetch();
  },

  'plugin/import'(importedId) {
    check(importedId, String);

    const plugin = Plugins.findOneByImportedId(importedId);
    if (!plugin) {
      throw new Meteor.Error('invalid-data');
    }

    return plugin.slug;
  },

  'plugin/search'(query: string) {
    check(query, Match.Maybe(String));

    if (query) {
      const filter = query.trim();
      if (filter) {
        return Plugins.searchPlugins(filter).fetch();
      }
    }

    return Plugins.findAll().fetch();
  },

  'plugin/submit'(pluginData: UploadedPlugin) {
    const userId = Meteor.userId();
    if (!userId) {
      throw new Meteor.Error('not-authorized');
    }

    check(pluginData, {
      name: String,
      description: Match.Optional(String),
      public: Boolean,
      versionName: String,
      externalLink: Match.Optional(String),
      platforms: [String],
      help: Match.Optional(String),
      fileHeader: Match.Optional({
        name: String,
        size: Number,
        type: String,
      }),
      fileData: Match.Optional(String),
    });

    const name = pluginData.name.trim().substr(0, 60);
    const description = pluginData.description?.trim().substr(0, 100);
    const versionName = pluginData.versionName.trim().substr(0, 40);
    const externalLink = pluginData.externalLink?.trim();
    let help = pluginData.help?.trim();
    if (help) {
      help = DOMPurify.sanitize(help, { ALLOWED_TAGS: [] })
    }
    const { fileHeader, fileData } = pluginData;

    if (!pluginData.platforms.length) {
      throw new Meteor.Error('invalid-data', 'missing-platform');
    }

    for (const platformCode of pluginData.platforms) {
      const platform = Platforms[platformCode];
      if (!platform) {
        throw new Meteor.Error('invalid-data', 'unknown-platform', platformCode);
      }
    }

    if (!externalLink && !fileData) {
      throw new Meteor.Error('invalid-data', 'missing-file');
    }

    let fileId;

    if (fileData) {
      if (!fileHeader) {
        throw new Meteor.Error('invalid-data');
      }

      try {
        validateFile(fileHeader)
      } catch(e) {
        throw new Meteor.Error(e.message);
      }

      fileId = Files.insertFile(fileHeader.name, fileHeader.size, fileHeader.type, fileData);
    }

    const newPluginData: Plugin = {
      name,
      description,
      help,
      tags: [],
      versions: [],
      reactions: {},
      reviews: [],
      score: 0,
      userId,
      public: pluginData.public,
    };

    newPluginData.versions.push({
      _id: Random.id(),
      name: versionName,
      externalLink,
      fileId,
      platforms: pluginData.platforms,
      _createdAt: new Date(),
      _updatedAt: new Date(),
    });

    const pluginId = Plugins.addPlugin(newPluginData);
    if (!pluginId) {
      return pluginId;
    }

    const savedPluginData = Plugins.findOneById(pluginId);
    return savedPluginData?.slug;
  },

  'plugin/submitFile'(pluginId, pluginData) {
    const userId = Meteor.userId();
    if (!userId) {
      throw new Meteor.Error('not-authorized');
    }

    check(pluginId, String);
    const plugin = Plugins.findOneByIdOrSlug(pluginId);
    if (!plugin) {
      throw new Meteor.Error('invalid-data');
    }

    if (plugin.userId !== userId) {
      throw new Meteor.Error('not-authorized');
    }

    check(pluginData, {
      versionName: String,
      externalLink: Match.Optional(String),
      platforms: [String],
      fileHeader: Match.Optional({
        name: String,
        size: Number,
        type: String,
      }),
      fileData: Match.Optional(String),
    });

    const versionName = pluginData.versionName.trim().substr(0, 40);
    const externalLink = pluginData.externalLink?.trim();
    const { fileHeader, fileData } = pluginData;

    if (!pluginData.platforms.length) {
      throw new Meteor.Error('invalid-data', 'missing-platform');
    }

    for (const platformCode of pluginData.platforms) {
      if (!(Platforms[platformCode])) {
        throw new Meteor.Error('invalid-data', 'unknown-platform', platformCode);
      }
    }

    if (!externalLink && !fileData) {
      throw new Meteor.Error('invalid-data', 'missing-file');
    }

    let fileId;
    if (fileData) {
      if (!fileHeader) {
        throw new Meteor.Error('invalid-data');
      }

      try {
        validateFile(fileHeader)
      } catch(e) {
        throw new Meteor.Error(e.message);
      }

      fileId = Files.insertFile(fileHeader.name, fileHeader.size, fileHeader.type, fileData);
    }

    const pluginVersion = {
      _id: Random.id(),
      name: versionName,
      externalLink,
      fileId,
      platforms: pluginData.platforms,
      _createdAt: new Date(),
      _updatedAt: new Date(),
    };

    Plugins.addVersion(plugin._id as string, pluginVersion);
  },

  'plugin/edit'(pluginData: ModifiedPlugin) {
    const userId = Meteor.userId();
    if (!userId) {
      throw new Meteor.Error('not-authorized');
    }

    check(pluginData, {
      _id: String,
      name: String,
      description: Match.Optional(String),
      public: Boolean,
      help: Match.Optional(String),
    });

    const plugin = Plugins.findOneById(pluginData._id);
    if (!plugin) {
      throw new Meteor.Error('invalid-data');
    }

    if (plugin.userId !== userId) {
      throw new Meteor.Error('not-authorized');
    }

    if (pluginData.help) {
      pluginData.help = DOMPurify.sanitize(pluginData.help);
    }

    Plugins.updatePlugin(pluginData);
  },

  'plugin/file/delete'(pluginId: string, fileId: string) {
    const userId = Meteor.userId();
    if (!userId) {
      throw new Meteor.Error('not-authorized');
    }

    check(pluginId, String);
    check(fileId, String);

    const plugin = Plugins.findOneByIdOrSlug(pluginId);
    if (!plugin) {
      throw new Meteor.Error('invalid-data');
    }

    if (plugin.userId !== userId) {
      throw new Meteor.Error('not-authorized');
    }

    for (const version of plugin.versions) {
      if (version._id === fileId) {
        Plugins.removeVersion(plugin._id as string, fileId);
        return;
      }
    }

    throw new Meteor.Error('invalid-data');
  },

  'plugin/review'(reviewData: SubmittedReview) {
    const userId = Meteor.userId();
    if (!userId) {
      throw new Meteor.Error('not-authorized');
    }

    check(reviewData, {
      pluginId: String,
      comment: String,
      rating: Number,
    });

    const plugin = Plugins.findOneById(reviewData.pluginId);
    if (!plugin) {
      throw new Meteor.Error('invalid-data');
    }

    if (plugin.userId === userId) {
      throw new Meteor.Error('not-authorized');
    }

    if (!reviewData.rating || isNaN(Number(reviewData.rating)) || reviewData.rating > 5) {
      throw new Meteor.Error('invalid-data');
    }

    if (!reviewData.comment) {
      throw new Meteor.Error('invalid-data');
    }

    for (const review of plugin.reviews) {
      if (review.userId === userId) {
        Plugins.updateUserReview(userId, reviewData);
        return;
      }
    }

    Plugins.addUserReview(userId, reviewData);
  },

  'plugin/review/delete'(pluginId: string) {
    const userId = Meteor.userId();
    if (!userId) {
      throw new Meteor.Error('not-authorized');
    }

    check(pluginId, String);

    const plugin = Plugins.findOneByIdOrSlug(pluginId);
    if (!plugin) {
      throw new Meteor.Error('invalid-data');
    }

    if (plugin.userId === userId) {
      throw new Meteor.Error('not-authorized');
    }

    for (const review of plugin.reviews) {
      if (review.userId === userId) {
        Plugins.removeUserReview(userId, plugin._id as string);
        return;
      }
    }

    throw new Meteor.Error('invalid-data');
  },

  'plugin/click'(pluginId: string) {
    const address = this.connection?.clientAddress;

    const plugin = Plugins.findOneByIdOrSlug(pluginId);
    if (plugin) {
      Clicks.insertClick(plugin._id as string, Meteor.userId(), address);
    }
  },

  'plugin/like'(pluginId: string) {
    const userId = Meteor.userId();
    if (!userId) {
      throw new Meteor.Error('not-authorized');
    }

    const plugin = Plugins.findOneByIdOrSlug(pluginId);
    if (!plugin) {
      throw new Meteor.Error('plugin-not-found');
    }

    if (Plugins.userLikedPlugin(userId, plugin._id as string)) {
      Plugins.dislike(plugin._id as string, userId);
    } else {
      Plugins.like(plugin._id as string, userId);
    }
  },

  'plugin/list'(platformCode: string) {
    check(platformCode, String);

    if (!Platforms[platformCode]) {
      throw new Meteor.Error('invalid-platform');
    }

    return Plugins.findPlatformMasterlist(platformCode).fetch();
  },

  'plugin/creators'() {
    const plugins = Plugins.findAllCreators().fetch();
    const creatorIds = [];
    const creatorPluginData = {};

    for (const plugin of plugins) {
      if (!creatorIds.includes(plugin.userId)) {
        creatorIds.push(plugin.userId);
      }

      if (!creatorPluginData[plugin.userId]) {
        creatorPluginData[plugin.userId] = {
          count: 0,
          latest: 0,
          platforms: [],
        };
      }

      if (creatorPluginData[plugin.userId].latest < plugin._createdAt) {
        creatorPluginData[plugin.userId].latest = plugin._createdAt;
      }

      const platforms = [];
      for (const version of plugin.versions) {
        for (const platform of version.platforms) {
          if (!platforms.includes(platform)) {
            platforms.push(platform);

            if (!creatorPluginData[plugin.userId].platforms.includes(platform)) {
              creatorPluginData[plugin.userId].platforms.push(platform);
            }
          }
        }
      }

      creatorPluginData[plugin.userId].count += platforms.length;
    }

    if (!creatorIds.length) {
      return [];
    }

    const users = Users.findAllInList(creatorIds).fetch();
    const creators = [];

    users.forEach(user => {
      const pluginCount = creatorPluginData[user._id]?.count ?? 0;
      const lastPluginDate = creatorPluginData[user._id]?.latest ?? 0;
      const platforms = creatorPluginData[user._id]?.platforms || [];

      if (pluginCount === 0) {
        return;
      }

      const avatar = gravatar.url(user.emails[0]?.address);
      delete user.emails;

      creators.push({
        pluginCount,
        platforms,
        lastPluginDate,
        avatar,
        ...user,
      });
    });

    return creators.sort((creator1, creator2) => {
      if (creator2.pluginCount === creator1.pluginCount) {
        return creator2.lastPluginDate - creator1.lastPluginDate;
      }

      return creator2.pluginCount - creator1.pluginCount;
    });
  }
});

DDPRateLimiter.addRule({
  type: 'method',
  name: 'plugin/click',
}, 5, 1000);

DDPRateLimiter.addRule({
  type: 'method',
  name: 'plugin/like',
}, 5, 1000);


DDPRateLimiter.addRule({
  type: 'method',
  name: 'plugin/submit',
}, 3, 10000);