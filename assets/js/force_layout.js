import lodashReduce from 'lodash/reduce'
import jQuery from 'jquery'
window.jQuery = jQuery

import {TabBar} from './info_box/tab_bar.js'
import {CauseRecompileList} from './info_box/top_stats/cause_recompile_list.js'
import {GetsRecompiledList} from './info_box/top_stats/gets_recompiled_list.js'

import {NodeForceLayout} from './node_force_layout.js'
import {ModeSwitcher} from './mode_switcher.js'
import {SelectedNodeDetails} from './info_box/selected_node_details.js'
import {FileSearch} from './info_box/file_search.js'

import { findPaths } from './force_utils.js'
import { renderGlossary } from './glossary.js'

import {
  COMPILE_LINE_STROKE,
  EXPORT_LINE_STROKE,
  RUNTIME_LINE_STROKE,
} from './constants'

window.vizSettings = {
  maxLabelsToShow: 10,
  logFilesToCompile: false
}
window.vizState = {
  // Either 'all-files', 'top-stats', or 'selected-file'
  infoBoxMode: 'all-files',

  // Mode is either 'deps' or 'ancestors'
  viewMode: 'deps',

  selectedNode: null,
}

const $projectName = jQuery('.info-box .project-name')
const $nav = jQuery('nav[role="navigation"]')

// Data
// targetObjects - Map from files to list of file objects w/type that they are depdendencies
// targets - Like targetObjects but just a plain list for each file
// causeRecompileMap - Map from files to list of files that they will cause to recompile
// getsRecompiledMap - Map from files to count of files that will cause the file to get recompile
//   Maybe change this a list also
//
// NOTE: There isn't a good reason that a function would need to take in both
// targets and targetObjects since targets can be derived from targetObjects

export function forceLayout(dataPromise) {
  dataPromise.then(data => {
    const nodeData = data.filter(row => row.type == "node")
    const linkData = data.filter(row => row.type == "edge")
    render(nodeData, linkData, "xref graph")
  })
}

export function render(nodeData, linkData, graphLabel) {
  console.log('graphLabel', graphLabel);
  transformData(linkData)
  window.linkData = linkData
  // console.log('linkData', linkData);
  // console.log('nodeData', nodeData);

  $projectName.text(graphLabel)

  const targets =
        lodashReduce(linkData, function(acc, link) {
          if (acc[link.source]) {
            acc[link.source].push(link.target)
          } else {
            acc[link.source] = [link.target]
          }
          return acc;
        }, {})

  const targetObjects =
        lodashReduce(linkData, function (acc, link) {
          const obj = {id: link.target, type: linkType(link.label)}
          if (acc[link.source]) {
            acc[link.source].push(obj)
          } else {
            acc[link.source] = [obj]
          }
          return acc
        }, {})

  const topPadding = 12
  // Add buffer mainly to get rid of the scroll bars
  const widthBuffer = 20
  const heightBuffer = 10
  const width = window.innerWidth - widthBuffer
  const height = window.innerHeight - $nav.outerHeight() - topPadding - heightBuffer
  console.log('height', height);

  const svg = d3.select('svg.main')
                .style('width', width)
                .style('height', height)

  const background = svg.select('g.bg')

  const zoomed = () => {
    // Note: If upgrading to d3 v6 the event will be passed into this function
    background.attr('transform', d3.event.transform)
  }

  svg
    .attr("viewBox", [0, 0, width, height])
    .call(d3.zoom()
             .extent([[0, 0], [width, height]])
             .scaleExtent([1, 8])
             .on('zoom', zoomed))

  const nodeForceLayout = new NodeForceLayout(nodeData, linkData, targetObjects, width, height)
  const selectedNodeDetails = new SelectedNodeDetails(targetObjects)
  const modeSwitcher = new ModeSwitcher(width)
  const getsRecompiledList = new GetsRecompiledList()
  const causeRecompileList = new CauseRecompileList()
  const tabBar = new TabBar()
  const fileSearch = new FileSearch(nodeData)

  fileSearch.initialize(nodeForceLayout, causeRecompileList, getsRecompiledList, tabBar, selectedNodeDetails)

  if (!window.Worker) alert("ERROR: Web Workers not supported")

  const worker = new Worker('js/graph_worker.js')
  worker.postMessage({type: 'init', targetObjects: targetObjects, nodeData: nodeData})
  worker.onmessage = e => {
    nodeForceLayout.initialize(e.data.dependenciesMap, e.data.causeRecompileMap, selectedNodeDetails, tabBar)
    selectedNodeDetails.initialize(e.data.dependenciesMap, e.data.causeRecompileMap, nodeForceLayout)
    modeSwitcher.initialize(nodeForceLayout, selectedNodeDetails)
    getsRecompiledList.initialize(e.data.dependenciesMap, nodeForceLayout, selectedNodeDetails, modeSwitcher, tabBar)
    causeRecompileList.initialize(e.data.causeRecompileMap, nodeForceLayout, modeSwitcher, selectedNodeDetails, tabBar)
    tabBar.initialize(nodeForceLayout, selectedNodeDetails, getsRecompiledList, causeRecompileList)

    renderTotalFileCount(e.data.getsRecompiledMap)
  }

  // TODO: Remove these and double-check that nothing breaks
  window.targets = targets
  window.targetObjects = targetObjects

  renderGlossary()

  findPaths(targetObjects, 'lib/demo_dep/a.ex', 'lib/demo_dep/b_runtime/c_runtime.ex')
  setTimeout(function() {
    // const id = 'lib/demo_dep/a.ex'
    // showOnlyThisNodeAndCompileDeps(id, force, nodeData, linkData, targetObjects)
    // selectedNodeDetails.infoBoxShowSelectedFilesDependencies(id)
  }, 500)
}

function renderTotalFileCount(getsRecompiledMap) {
  const totalFileCount = Object.keys(getsRecompiledMap).length
  jQuery('.total-files-count').text(totalFileCount)
}

function transformData(linkData) {
  linkData.forEach(d => {
    if (d.label == "(compile)") {
      d.stroke = COMPILE_LINE_STROKE
      d.dependencyType = 'compile'
    } else if (d.label == "(export)") {
      d.stroke = EXPORT_LINE_STROKE
      d.dependencyType = 'export'
    } else {
      d.stroke = RUNTIME_LINE_STROKE
      d.dependencyType = 'runtime'
    }
  })
}

function linkType(label) {
  switch(label) {
    case "(compile)": return 'compile'
    case "(export)": return 'export'
    default: return 'runtime'
  }
}
