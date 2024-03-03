const Dockerode = require('dockerode')
const { isEmpty, mergeDeepRight } = require('ramda')
const { Component } = require('@serverless/core')

const defaults = {
  dockerHost: '127.0.0.1',
  dockerPort: 3000,
  dockerfile: 'Dockerfile',
  context: process.cwd(),
  registryAddress: 'https://index.docker.io/v1',
  push: false
}

const isDebug = () => {
  const { SLS_DEBUG = '' } = process.env
  return ['true', '*'].includes(SLS_DEBUG) || SLS_DEBUG.split(',').includes('docker-image')
}

class DockerImage extends Component {
  async default(inputs = {}) {
    const config = mergeDeepRight(defaults, inputs)

    const docker = this.getDockerClient(config.dockerHost, config.dockerPort)
    await this.isDockerRunning(docker)

    await this.buildImage(docker, config)

    if (config.push) {
      const { username, password } = this.context.credentials.docker
      const auth = {
        username,
        password,
        serveraddress: config.registryAddress
      }
      const params = Object.assign({}, config, { auth })
      await this.pushImage(docker, params)
    }

    this.state = config
    await this.save()
    return this.state
  }

  async remove(inputs = {}) {
    let config = mergeDeepRight(defaults, inputs)
    if (isEmpty(config)) {
      config = this.state
    }

    const docker = this.getDockerClient(config.dockerHost, config.dockerPort)
    await this.isDockerRunning(docker)

    await this.removeImage(docker, config)

    this.state = {}
    await this.save()
    return {}
  }

  async build(inputs = {}) {
    const config = mergeDeepRight(defaults, inputs)

    const docker = this.getDockerClient(config.dockerHost, config.dockerPort)
    await this.isDockerRunning(docker)

    await this.buildImage(docker, config)

    this.state = config
    await this.save()
    return this.state
  }

  async push(inputs = {}) {
    const config = mergeDeepRight(defaults, inputs)

    const docker = this.getDockerClient(config.dockerHost, config.dockerPort)
    await this.isDockerRunning(docker)

    const { username, password } = this.context.credentials.docker
    const auth = {
      username,
      password,
      serveraddress: config.registryAddress
    }
    const params = Object.assign({}, config, { auth })
    await this.pushImage(docker, params)

    this.state = config
    await this.save()
    return this.state
  }

  // "private" methods
  getDockerClient(host, port) {
    return new Dockerode({ dockerHost: host, dockerPort: port })
  }

  async isDockerRunning(docker) {
    try {
      await docker.listContainers()
    } catch (error) {
      throw new Error('Docker is not running. Please check your config and try again...')
    }
  }

  async buildImage(docker, { dockerfile, context, repository, tag }) {
    const t = `${repository}:${tag}`
    const stream = await docker.buildImage({ context }, { dockerfile, t })
    return new Promise((resolve, reject) => {
      docker.modem.followProgress(stream, (err, res) => {
        if (err) {
          console.error(err)
          return reject(err)
        }
        if (isDebug()) {
          console.log((res || []).map((it) => it.stream).join(''))
        }
        const [{ error }] = (res || []).slice(-1)
        if (error) {
          if (!isDebug()) console.error((res || []).map((it) => it.stream).join(''))
          reject(new Error(error))
          return
        }
        return resolve(res)
      })
    })
  }

  async removeImage(docker, { repository, tag }) {
    const imageName = `${repository}:${tag}`
    const image = docker.getImage(imageName)
    return image.remove({ name: repository })
  }

  async pushImage(docker, { repository, tag, auth }) {
    const imageName = `${repository}:${tag}`
    const image = docker.getImage(imageName)
    return new Promise((resolve, reject) => {
      image.push(
        { name: repository, tag },
        (err, stream) => {
          if (err) {
            console.error(err)
            reject(err)
          }
          docker.modem.followProgress(stream, (err, res = []) => {
            if (err) {
              console.error(err)
              reject(err)
              return
            }
            if (isDebug()) {
              console.log((res || []).map((it) => it.stream).join(''))
            }
            const [{ error }] = res.slice(-1)
            if (error) {
              if (!isDebug()) console.error((res || []).map((it) => it.stream).join(''))
              reject(new Error(error))
              return
            }
            resolve(res)
          })
        },
        auth
      )
    })
  }
}

module.exports = DockerImage
