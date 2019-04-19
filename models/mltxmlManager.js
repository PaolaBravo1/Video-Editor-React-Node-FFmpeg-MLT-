/**
 * @file Manager for work with MLT files
 * @author Vladan Kudlac <vladankudlac@gmail.com>
 */

import config from '../config';
import timeManager from './timeManager';

const fs = require('fs');
const path = require('path');

export default {

	/**
	 * Save string as MLT file for specified project (create new or overwrite existing)
	 *
	 * @param project
	 * @param data String without XML declaration and without doctype
	 * @return {Promise<any>}
	 */
	saveMLT(project, data) {
	const filepath = path.join(config.projectPath, project, 'project.mlt');

		return new Promise((resolve, reject) => {
			fs.writeFile(filepath, (config.declareXML + data), (err) => {
				if (err) {
					console.warn(new Date(), `Unable to update file ${filepath}`);
					reject(err);
				}

				console.info(new Date(), `File ${filepath} updated.`);
				resolve();
			});
		});
	},


	/**
	 * Check if entry is without any filter or transition
	 *
	 * @param {Element} node
	 * @return {boolean}
	 */
	isSimpleNode(node) {
		return (node.tagName === 'entry');
	},


	/**
	 * Get NTH element of playlist - entry (for simple) / track (for complex)
	 *
	 * @param {Document} document
	 * @param {Element} track
	 * @param {Number} index
	 * @return {Element}
	 */
	getItem(document, track, index) {
		let i = 0;
		const entries = track.childNodes;
		for (let entry of entries) {
			// Simple entry
			if (new RegExp(/^producer/).test(entry.getAttribute('producer'))) {
				if (i === index) {
					return entry;
				}
				i++;
			}
			// Container of entries
			else {
				const tractor = document.getElementById(entry.getAttribute('producer'));
				const tracks = tractor.getElementsByTagName('multitrack').item(0).childNodes;
				for (let track of tracks) {
					if (i === index) {
						return track;
					}
					i++;
				}
			}
		}
		return null;
	},


	/**
	 * Get relative path of MLT file for specified project
	 *
	 * @param {String} projectID
	 * @return {string}
	 */
	getMLTpath(projectID) {
		return path.join(config.projectPath, projectID, 'project.mlt');
	},


	/**
	 * Get relative path of project directory
	 *
	 * @param {String} projectID
	 * @return {string}
	 */
	getWorkerDir(projectID) {
		return path.join(config.projectPath, projectID);
	},


	/**
	 * Get index of track in multitrack
	 *
	 * @param {Element} track
	 * @return {number}
	 */
	getTrackIndex(track) {
		let index = 0;
		while (track = track.previousElementSibling) {
			index++;
		}
		return index;
	},


	/**
	 * Check if track is used in any filter or transition
	 *
	 * @param {Element} track
	 * @return {boolean}
	 */
	isUsedInTractor(track) {
		const tractor = track.parentElement.parentElement;
		const trackIndex = this.getTrackIndex(track);

		const filters = tractor.getElementsByTagName('filter');
		for (let filter of filters) {
			if (filter.getAttribute('track') === trackIndex.toString()) return true;
		}

		const transitions = tractor.getElementsByTagName('transition');
		for (let transition of transitions) {
			if (transition.getAttribute('a_track') === trackIndex.toString()) return true;
			if (transition.getAttribute('b_track') === trackIndex.toString()) return true;
		}

		return false;
	},


	/**
	 * Get in, out and duration of timeline item
	 *
	 * @param {Element} element
	 * @param {Document} document
	 * @return {{in: string, time: string, out: string}}
	 */
	getDuration(element, document) {
		const duration = {
			in: undefined,
			out: undefined,
			time: undefined,
		};
		if (element.tagName === 'multitrack') {
			const lastTrack = element.childNodes.item(element.childElementCount - 1);
			const playlist = document.getElementById(lastTrack.getAttribute('producer'));
			duration.time = playlist.childNodes.item(0).getAttribute('length');
			if (duration.time === null)
				duration.time = this.getDuration(playlist.childNodes.item(playlist.childElementCount - 1), document).time;
			else
				duration.time = timeManager.addDuration(duration.time, this.getDuration(playlist.childNodes.item(playlist.childElementCount - 1), document).time);
		}
		else {
			if (element.tagName === 'track') {
				const playlist = document.getElementById(element.getAttribute('producer'));
				element = playlist.getElementsByTagName('entry').item(0);
			}

			duration.in = element.getAttribute('in');
			duration.out = element.getAttribute('out');

			if (duration.in === null) {
				duration.in = '00:00:00,000';
			}

			if (duration.out === null) {
				const producer = document.getElementById(element.getAttribute('producer'));
				const properties = producer.getElementsByTagName('property');
				for (let property of properties) {
					if (property.getAttribute('name') === 'length') duration.out = property.innerHTML;
				}
			}

			if (duration.in > duration.out) throw(`Attribute in is greater than out: ${element.outerHTML}`);

			duration.time = timeManager.subDuration(duration.out, duration.in);
		}
			return duration;
	},


	/**
	 * Create playlist and put the item as entry into it
	 *
	 * @param {Element} item
	 * @param {Document} document
	 * @return {Element} new playlist element
	 */
	entryToPlaylist(item, document) {
		const playlists = document.querySelectorAll('mlt>playlist[id^="playlist"]');
		const producers = document.getElementsByTagName('producer');
		const lastProducer = producers.item(producers.length - 1);
		const newPlaylist = document.createElement('playlist');
		newPlaylist.id = 'playlist' + playlists.length;
		newPlaylist.innerHTML = item.outerHTML;
		lastProducer.parentElement.insertBefore(newPlaylist, lastProducer.nextSibling);
		return newPlaylist;
	},


	/**
	 *
	 *
	 * @param {Element} multitrack
	 * @param {Element} playlist
	 * @param {String} overlapping
	 * @param {String} transition
	 * @param {Document} document
	 */
	appendPlaylistToMultitrack(multitrack, playlist, overlapping, transition, document) {
		const duration = timeManager.subDuration(this.getDuration(multitrack, document).time, overlapping);
		if (playlist.getElementsByTagName('blank').length > 0)
			playlist.childNodes.item(0).remove();
		playlist.innerHTML = `<blank length="${duration}" />` + playlist.innerHTML;
		multitrack.innerHTML += `<track producer="${playlist.id}" />`;

		const transitionElement = document.createElement('transition');
		transitionElement.setAttribute('mlt_service', transition);
		transitionElement.setAttribute('in', duration);
		transitionElement.setAttribute('out', timeManager.addDuration(duration, overlapping));
		transitionElement.setAttribute('a_track', multitrack.childElementCount - 2);
		transitionElement.setAttribute('b_track', multitrack.childElementCount - 1);
		multitrack.parentElement.append(transitionElement);
	},


	/**
	 * Create tractor and put it before videotrack0
	 *
	 * @param {Document} document
	 * @return {Element} new tractor element
	 */
	createTractor(document) {
		const tractors = document.querySelectorAll('mlt>tractor[id^="tractor"]');
		const videotrack0 = document.getElementById('videotrack0');
		const newTractor = document.createElement('tractor');
		newTractor.id = 'tractor' + tractors.length;
		videotrack0.parentElement.insertBefore(newTractor, videotrack0);
		return newTractor;
	}
}
