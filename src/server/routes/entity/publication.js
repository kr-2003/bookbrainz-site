/*
 * Copyright (C) 2015  Ben Ockmore
 *               2015  Sean Burke
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
 */

'use strict';

/* eslint camelcase: 1 */

const express = require('express');
const router = express.Router();
const auth = require('../../helpers/auth');
const Publication = require('../../data/entities/publication');
const Edition = require('../../data/entities/edition');
const User = require('../../data/user');

/* Middleware loader functions. */
const makeEntityLoader = require('../../helpers/middleware').makeEntityLoader;

const React = require('react');
const EditForm = React.createFactory(require('../../../client/components/forms/publication.jsx'));
// Creation

const loadLanguages = require('../../helpers/middleware').loadLanguages;
const loadPublicationTypes = require('../../helpers/middleware').loadPublicationTypes;
const loadEntityRelationships = require('../../helpers/middleware').loadEntityRelationships;
const loadIdentifierTypes = require('../../helpers/middleware').loadIdentifierTypes;

const bbws = require('../../helpers/bbws');
const Promise = require('bluebird');
const _ = require('underscore');

/* If the route specifies a BBID, load the Publication for it. */
router.param('bbid', makeEntityLoader(Publication, 'Publication not found'));

router.get('/:bbid', loadEntityRelationships, function(req, res) {
	const publication = res.locals.entity;
	let title = 'Publication';

	publication.editions = publication.editions.map(function(edition) {
		return Edition.findOne(edition.bbid, {
			populate: ['disabmiguation', 'aliases']
		});
	});

	if (publication.default_alias && publication.default_alias.name) {
		title = 'Publication “' + publication.default_alias.name + '”';
	}

	Promise.all(publication.editions).then(function(editions) {
		publication.editions = editions;

		// Get unique identifier types for display
		const identifier_types = _.uniq(
			_.pluck(publication.identifiers, 'identifier_type'),
			(identifier) => identifier.identifier_type_id
		);

		res.render('entity/view/publication', {
			title: title,
			identifier_types: identifier_types
		});
	});
});

router.get('/:bbid/delete', auth.isAuthenticated, function(req, res) {
	const publication = res.locals.entity;
	let title = 'Publication';

	if (publication.default_alias && publication.default_alias.name) {
		title = 'Publication “' + publication.default_alias.name + '”';
	}

	res.render('entity/delete', {
		title: title
	});
});

router.post('/:bbid/delete/confirm', function(req, res) {
	const publication = res.locals.entity;

	Publication.del(
		publication.bbid,
		{revision: {note: req.body.note}},
		{session: req.session}
	)
		.then(function() {
			res.redirect(303, '/publication/' + publication.bbid);
		});
});

router.get('/:bbid/revisions', function(req, res) {
	const publication = res.locals.entity;
	let title = 'Publication';

	if (publication.default_alias && publication.default_alias.name) {
		title = 'Publication “' + publication.default_alias.name + '”';
	}

	bbws.get('/publication/' + publication.bbid + '/revisions')
		.then(function(revisions) {
			const promisedUsers = {};
			revisions.objects.forEach(function(revision) {
				if (!promisedUsers[revision.user.user_id]) {
					promisedUsers[revision.user.user_id] = User.findOne(revision.user.user_id);
				}
			});

			Promise.props(promisedUsers).then(function(users) {
				res.render('entity/revisions', {
					title: title,
					revisions: revisions,
					users: users
				});
			});
		});
});

// Creation

router.get('/create', auth.isAuthenticated, loadIdentifierTypes, loadLanguages, loadPublicationTypes, function(req, res) {
	const props = {
		languages: res.locals.languages,
		publicationTypes: res.locals.publicationTypes,
		identifierTypes: res.locals.identifierTypes,
		submissionUrl: '/publication/create/handler'
	};

	const markup = React.renderToString(EditForm(props));

	res.render('entity/create/publication', {
		title: 'Add Publication',
		heading: 'Create Publication',
		subheading: 'Add a new Publication to BookBrainz',
		props: props,
		markup: markup
	});
});

router.get('/:bbid/edit', auth.isAuthenticated, loadIdentifierTypes, loadPublicationTypes, loadLanguages, function(req, res) {
	const publication = res.locals.entity;

	const props = {
		languages: res.locals.languages,
		publicationTypes: res.locals.publicationTypes,
		publication: publication,
		identifierTypes: res.locals.identifierTypes,
		submissionUrl: '/publication/' + publication.bbid + '/edit/handler'
	};

	const markup = React.renderToString(EditForm(props));

	res.render('entity/create/publication', {
		title: 'Edit Publication',
		heading: 'Edit Publication',
		subheading: 'Edit an existing Publication in BookBrainz',
		props: props,
		markup: markup
	});
});

router.post('/create/handler', auth.isAuthenticated, function(req, res) {
	const changes = {
		bbid: null,
		publication_type: {
			publication_type_id: req.body.publicationTypeId
		}
	};

	if (req.body.disambiguation) {
		changes.disambiguation = req.body.disambiguation;
	}

	if (req.body.annotation) {
		changes.annotation = req.body.annotation;
	}

	if (req.body.note) {
		changes.revision = {
			note: req.body.note
		};
	}

	const newIdentifiers = req.body.identifiers.map(function(identifier) {
		return {
			value: identifier.value,
			identifier_type: {
				identifier_type_id: identifier.typeId
			}
		};
	});

	if (newIdentifiers.length) {
		changes.identifiers = newIdentifiers;
	}

	const newAliases = [];

	req.body.aliases.forEach(function(alias) {
		if (!alias.name && !alias.sortName) {
			return;
		}

		newAliases.push({
			name: alias.name,
			sort_name: alias.sortName,
			language_id: alias.language,
			primary: alias.primary,
			default: alias.default
		});
	});

	if (newAliases.length) {
		changes.aliases = newAliases;
	}

	Publication.create(changes, {
		session: req.session
	})
		.then(function(revision) {
			res.send(revision);
		});
});

router.post('/:bbid/edit/handler', auth.isAuthenticated, function(req, res) {
	const publication = res.locals.entity;

	const changes = {
		bbid: publication.bbid
	};

	const publicationTypeId = req.body.publicationTypeId;
	if ((!publication.publication_type) ||
		(publication.publication_type.publication_type_id !== publicationTypeId)) {
		changes.publication_type = {
			publication_type_id: publicationTypeId
		};
	}

	const disambiguation = req.body.disambiguation;
	if ((!publication.disambiguation) ||
		(publication.disambiguation.comment !== disambiguation)) {
		changes.disambiguation = disambiguation ? disambiguation : null;
	}

	const annotation = req.body.annotation;
	if ((!publication.annotation) ||
		(publication.annotation.content !== annotation)) {
		changes.annotation = annotation ? annotation : null;
	}

	if (req.body.note) {
		changes.revision = {
			note: req.body.note
		};
	}

	const currentIdentifiers = publication.identifiers.map(function(identifier) {
		const nextIdentifier = req.body.identifiers[0];

		if (identifier.id !== nextIdentifier.id) {
			// Remove the alias
			return [identifier.id, null];
		}
		else {
			// Modify the alias
			req.body.identifiers.shift();
			return [nextIdentifier.id, {
				value: nextIdentifier.value,
				identifier_type: {
					identifier_type_id: nextIdentifier.typeId
				}
			}];
		}
	});

	const newIdentifiers = req.body.identifiers.map(function(identifier) {
		// At this point, the only aliases should have null IDs, but check anyway.
		if (identifier.id) {
			return null;
		}
		else {
			return [null, {
				value: identifier.value,
				identifier_type: {
					identifier_type_id: identifier.typeId
				}
			}];
		}
	});

	changes.identifiers = currentIdentifiers.concat(newIdentifiers);

	const currentAliases = [];

	publication.aliases.forEach(function(alias) {
		const nextAlias = req.body.aliases[0];

		if (alias.id !== nextAlias.id) {
			// Remove the alias
			currentAliases.push([alias.id, null]);
		}
		else {
			// Modify the alias
			req.body.aliases.shift();
			currentAliases.push([nextAlias.id, {
				name: nextAlias.name,
				sort_name: nextAlias.sortName,
				language_id: nextAlias.language,
				primary: nextAlias.primary,
				default: nextAlias.default
			}]);
		}
	});

	const newAliases = [];

	req.body.aliases.forEach(function(alias) {
		// At this point, the only aliases should have null IDs, but check anyway.
		if (alias.id || (!alias.name && !alias.sortName)) {
			return;
		}

		newAliases.push([null, {
			name: alias.name,
			sort_name: alias.sortName,
			language_id: alias.language,
			primary: alias.primary,
			default: alias.default
		}]);
	});

	changes.aliases = currentAliases.concat(newAliases);

	Publication.update(publication.bbid, changes, {
		session: req.session
	})
		.then(function(revision) {
			res.send(revision);
		});
});

module.exports = router;
